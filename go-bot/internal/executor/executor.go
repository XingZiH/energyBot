package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fbsobreira/gotron-sdk/pkg/address"
	"github.com/fbsobreira/gotron-sdk/pkg/client"
	"github.com/fbsobreira/gotron-sdk/pkg/client/transaction"
	"github.com/fbsobreira/gotron-sdk/pkg/keys"
	"github.com/fbsobreira/gotron-sdk/pkg/proto/api"
	"github.com/fbsobreira/gotron-sdk/pkg/proto/core"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ng-antd-admin/go-bot/internal/config"
)

const (
	justLendDashboardURL              = "https://labc.ablesdxd.link/strx/dashboard"
	justLendRentOrdersURL             = "https://labc.ablesdxd.link/strx/rent/allOrderList"
	tronGRPCEndpoint                  = "grpc.trongrid.io:50051"
	tronResourceEnergy                = 1
	feeLimitSun                       = 50_000_000
	maxReturnAttempts                 = 3
	justLendReceiptWait               = 90 * time.Second
	justLendReceiptTick               = 3 * time.Second
	officialRentalExpiryRetryAttempts = 6
	officialRentalExpiryRetryInterval = 2 * time.Second
	officialRentalScheduleTolerance   = 30 * time.Second

	justLendRentResourceMethod   = "rentResource(address,uint256,uint256)"
	justLendReturnResourceMethod = "returnResource(address,uint256,uint256)"
)

var errOfficialRentalOrderNotFound = errors.New("official justlend rental order not found")

type Service struct {
	cfg        config.Config
	db         *pgxpool.Pool
	httpClient *http.Client
	logger     *log.Logger
}

type Dashboard struct {
	EnergyRentPerTrx  any `json:"energyRentPerTrx"`
	EnergyStakePerTrx any `json:"energyStakePerTrx"`
}

type RentalAmounts struct {
	DelegatedSun int64
	PrepaySun    int64
	RentFeeSun   int64
}

type IncomingTransfer struct {
	TxID        string
	FromAddress string
	ToAddress   string
	AmountSun   int64
	ConfirmedAt time.Time
}

type PendingOrder struct {
	ID               int
	OrderNo          string
	PackageName      string
	ReceiverAddress  string
	EnergyAmount     int
	DurationHours    int
	PaymentAmountSun int64
	CreatedAt        time.Time
	PaymentExpiresAt time.Time
	Remark           string
}

type ExpiredOrder struct {
	ID               int
	OrderNo          string
	PackageName      string
	PaymentAmountSun int64
	Remark           string
}

type PaidOrder struct {
	ID                          int
	OrderNo                     string
	ReceiverAddress             string
	EnergyAmount                int
	DurationHours               int
	PaymentTxHash               string
	Remark                      string
	Provider                    string
	ExternalOrderID             string
	ExternalProviderEnvironment string
}

type ReturnTask struct {
	ID                 int
	OrderID            int
	OrderNo            string
	ReceiverAddress    string
	EnergyAmount       int
	DurationHours      int
	DelegatedAmountSun int64
	Attempts           int
	Remark             string
}

type officialRentOrderListResponse struct {
	Code    int                         `json:"code"`
	Message string                      `json:"message"`
	Data    officialRentOrderListResult `json:"data"`
}

type officialRentOrderListResult struct {
	Orders         []officialRentOrder `json:"orders"`
	ReceiverOrders []officialRentOrder `json:"receiverOrders"`
}

type officialRentOrder struct {
	Renter            string `json:"renter"`
	Receiver          string `json:"receiver"`
	EnergyAmount      string `json:"energyAmount"`
	DelegateTrxAmount string `json:"delegateTrxAmount"`
	CanRentSeconds    string `json:"canRentSeconds"`
	StartTimestamp    string `json:"startTimestamp"`
}

type rentingOrderForScheduleSync struct {
	ID              int
	OrderNo         string
	ReceiverAddress string
	ExpiresAt       time.Time
}

type tronGridTransactionsResponse struct {
	Data []tronGridTransaction `json:"data"`
}

type tronGridTransaction struct {
	TxID           string `json:"txID"`
	BlockTimestamp int64  `json:"block_timestamp"`
	Ret            []struct {
		ContractRet string `json:"contractRet"`
	} `json:"ret"`
	RawData struct {
		Contract []struct {
			Type      string `json:"type"`
			Parameter struct {
				Value struct {
					Amount       int64  `json:"amount"`
					OwnerAddress string `json:"owner_address"`
					ToAddress    string `json:"to_address"`
				} `json:"value"`
			} `json:"parameter"`
		} `json:"contract"`
	} `json:"raw_data"`
}

func New(cfg config.Config, db *pgxpool.Pool, logger *log.Logger) (*Service, error) {
	if db == nil {
		return nil, errors.New("database pool is required")
	}
	if logger == nil {
		logger = log.Default()
	}
	return &Service{
		cfg:        cfg,
		db:         db,
		httpClient: &http.Client{Timeout: 20 * time.Second},
		logger:     logger,
	}, nil
}

func (s *Service) RunOnce(ctx context.Context) error {
	if err := s.processIncomingPayments(ctx); err != nil {
		return err
	}
	if err := s.processPaidOrders(ctx); err != nil {
		return err
	}
	if err := s.cancelExpiredPendingOrders(ctx, time.Now()); err != nil {
		return err
	}
	if s.cfg.UsesJustLend() {
		if err := s.syncOfficialRentalExpirations(ctx); err != nil {
			s.logger.Printf("sync official rental expirations failed: %v", err)
		}
		if err := s.processDueReturns(ctx); err != nil {
			return err
		}
	}
	if err := s.syncCatFeeRentingOrders(ctx); err != nil {
		s.logger.Printf("sync catfee rental orders failed: %v", err)
	}
	return nil
}

func (s *Service) processIncomingPayments(ctx context.Context) error {
	pendingOrders, err := s.fetchPendingOrders(ctx)
	if err != nil {
		return err
	}
	if len(pendingOrders) == 0 {
		return nil
	}

	transfers, err := s.fetchIncomingTransfers(ctx)
	if err != nil {
		return err
	}
	for _, transfer := range transfers {
		order, ok := findMatchingOrder(transfer, pendingOrders)
		if !ok {
			continue
		}
		marked, err := s.markOrderPaid(ctx, order, transfer)
		if err != nil {
			return err
		}
		if marked {
			s.logger.Printf("payment matched: order=%s tx=%s amount_sun=%d", order.OrderNo, transfer.TxID, transfer.AmountSun)
			s.notifyOrderChat(ctx, order.Remark, fmt.Sprintf("✅ 支付已到账\n\n订单号：%s\n付款金额：%s TRX\n\n系统正在下发能量，请稍等。", order.OrderNo, formatTRX(transfer.AmountSun)))
		}
	}
	return nil
}

func (s *Service) processPaidOrders(ctx context.Context) error {
	orders, err := s.fetchPaidOrders(ctx)
	if err != nil {
		return err
	}
	if len(orders) == 0 {
		return nil
	}

	var dashboard *Dashboard
	for _, order := range orders {
		if normalizeProviderName(order.Provider) == "catfee" {
			if err := s.processCatFeePaidOrder(ctx, order); err != nil {
				s.logger.Printf("catfee rent energy failed: order=%s error=%v", order.OrderNo, err)
			}
			continue
		}

		if dashboard == nil {
			value, err := s.fetchDashboard(ctx)
			if err != nil {
				return err
			}
			dashboard = &value
		}
		amounts, err := rentalAmountsFromDashboard(order.EnergyAmount, time.Duration(order.DurationHours)*time.Hour, *dashboard)
		if err != nil {
			return fmt.Errorf("calculate rental amounts for order %s: %w", order.OrderNo, err)
		}

		txID, receipt, err := s.executeJustLend(ctx, justLendRentResourceMethod, order.ReceiverAddress, amounts.DelegatedSun, amounts.PrepaySun)
		if err != nil {
			s.logger.Printf("rent energy failed: order=%s error=%v", order.OrderNo, err)
			continue
		}
		expiresAt, synced, err := s.fetchOfficialRentalExpirationWithRetry(ctx, order.ReceiverAddress)
		if err != nil {
			s.logger.Printf("fetch official rental expiration failed: order=%s error=%v", order.OrderNo, err)
		}
		if !synced {
			expiresAt = time.Now().Add(s.cfg.EnergyRentalTTL)
		}
		if err := s.markOrderRenting(ctx, order, txID, amounts, expiresAt, receipt); err != nil {
			return err
		}
		s.logger.Printf("energy rented: order=%s tx=%s delegated_sun=%d prepay_sun=%d", order.OrderNo, txID, amounts.DelegatedSun, amounts.PrepaySun)
		s.notifyOrderChat(ctx, order.Remark, fmt.Sprintf("⚡ 能量已下发\n\n订单号：%s\n能量数量：%d\n租赁时长：%d 小时\n交易哈希：%s\n\n到期后系统会自动归还。", order.OrderNo, order.EnergyAmount, order.DurationHours, txID))
	}
	return nil
}

func (s *Service) processDueReturns(ctx context.Context) error {
	tasks, err := s.fetchDueReturnTasks(ctx)
	if err != nil {
		return err
	}
	if len(tasks) == 0 {
		return nil
	}

	var dashboard *Dashboard
	for _, task := range tasks {
		delegatedSun := task.DelegatedAmountSun
		if delegatedSun <= 0 {
			if dashboard == nil {
				value, err := s.fetchDashboard(ctx)
				if err != nil {
					return err
				}
				dashboard = &value
			}
			amounts, err := rentalAmountsFromDashboard(task.EnergyAmount, time.Duration(task.DurationHours)*time.Hour, *dashboard)
			if err != nil {
				return fmt.Errorf("calculate return amount for order %s: %w", task.OrderNo, err)
			}
			delegatedSun = amounts.DelegatedSun
		}

		locked, err := s.markReturnTaskRunning(ctx, task.ID)
		if err != nil {
			return err
		}
		if !locked {
			continue
		}

		txID, receipt, err := s.executeJustLend(ctx, justLendReturnResourceMethod, task.ReceiverAddress, delegatedSun, 0)
		if err != nil {
			if markErr := s.markReturnTaskFailed(ctx, task, err); markErr != nil {
				return markErr
			}
			s.logger.Printf("return energy failed: order=%s task=%d error=%v", task.OrderNo, task.ID, err)
			continue
		}

		if err := s.markReturnTaskCompleted(ctx, task, txID, receipt); err != nil {
			return err
		}
		s.logger.Printf("energy returned: order=%s task=%d tx=%s", task.OrderNo, task.ID, txID)
		s.notifyOrderChat(ctx, task.Remark, fmt.Sprintf("♻️ 能量已到期归还\n\n订单号：%s\n归还交易：%s", task.OrderNo, txID))
	}
	return nil
}

func (s *Service) fetchIncomingTransfers(ctx context.Context) ([]IncomingTransfer, error) {
	endpoint, err := url.Parse(strings.TrimRight(s.cfg.TronAPIBaseURL, "/") + "/v1/accounts/" + url.PathEscape(s.cfg.PlatformReceiveAddress) + "/transactions")
	if err != nil {
		return nil, err
	}
	query := endpoint.Query()
	query.Set("only_to", "true")
	query.Set("only_confirmed", "true")
	query.Set("limit", "200")
	query.Set("min_timestamp", strconv.FormatInt(time.Now().Add(-24*time.Hour).UnixMilli(), 10))
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(s.cfg.TronAPIKey) != "" {
		req.Header.Set("TRON-PRO-API-KEY", s.cfg.TronAPIKey)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("trongrid transactions failed: %s %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var response tronGridTransactionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, err
	}
	return parseTronGridTransfers(response, s.cfg.PlatformReceiveAddress), nil
}

func (s *Service) fetchDashboard(ctx context.Context) (Dashboard, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, justLendDashboardURL, nil)
	if err != nil {
		return Dashboard{}, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return Dashboard{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Dashboard{}, fmt.Errorf("justlend dashboard failed: %s", resp.Status)
	}

	decoder := json.NewDecoder(resp.Body)
	decoder.UseNumber()
	var body struct {
		Code int       `json:"code"`
		Data Dashboard `json:"data"`
	}
	if err := decoder.Decode(&body); err != nil {
		return Dashboard{}, err
	}
	if body.Code != 0 {
		return Dashboard{}, fmt.Errorf("justlend dashboard returned code %d", body.Code)
	}
	return body.Data, nil
}

func (s *Service) fetchOfficialRentalExpirationWithRetry(ctx context.Context, receiver string) (time.Time, bool, error) {
	renter, err := justLendPayerAddress(s.cfg.JustLendPayerPrivateKey)
	if err != nil {
		return time.Time{}, false, err
	}

	var lastErr error
	for attempt := 0; attempt < officialRentalExpiryRetryAttempts; attempt++ {
		expiresAt, err := s.fetchOfficialRentalExpiration(ctx, renter, receiver)
		if err == nil {
			return expiresAt, true, nil
		}
		lastErr = err
		if attempt+1 == officialRentalExpiryRetryAttempts {
			break
		}

		timer := time.NewTimer(officialRentalExpiryRetryInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return time.Time{}, false, ctx.Err()
		case <-timer.C:
		}
	}
	if lastErr == nil {
		lastErr = errOfficialRentalOrderNotFound
	}
	return time.Time{}, false, lastErr
}

func (s *Service) fetchOfficialRentalExpiration(ctx context.Context, renter string, receiver string) (time.Time, error) {
	endpoint, err := url.Parse(justLendRentOrdersURL)
	if err != nil {
		return time.Time{}, err
	}
	query := endpoint.Query()
	query.Set("renter", strings.TrimSpace(renter))
	query.Set("receiver", strings.TrimSpace(receiver))
	query.Set("rentType", "1")
	query.Set("orderBy", "0")
	query.Set("page", "0")
	query.Set("pageSize", "10")
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return time.Time{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "ng-antd-admin-energy-bot/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return time.Time{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return time.Time{}, fmt.Errorf("justlend rent orders failed: %s %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var body officialRentOrderListResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return time.Time{}, err
	}
	if body.Code != 0 {
		if strings.TrimSpace(body.Message) == "" {
			body.Message = strconv.Itoa(body.Code)
		}
		return time.Time{}, fmt.Errorf("justlend rent orders returned code %d: %s", body.Code, body.Message)
	}

	order, ok := findOfficialRentOrder(body.Data, renter, receiver)
	if !ok {
		return time.Time{}, errOfficialRentalOrderNotFound
	}
	return officialRentalExpiration(time.Now(), order)
}

func findOfficialRentOrder(data officialRentOrderListResult, renter string, receiver string) (officialRentOrder, bool) {
	renter = strings.TrimSpace(renter)
	receiver = strings.TrimSpace(receiver)
	for _, order := range data.Orders {
		if strings.EqualFold(strings.TrimSpace(order.Renter), renter) && strings.EqualFold(strings.TrimSpace(order.Receiver), receiver) {
			return order, true
		}
	}
	for _, order := range data.ReceiverOrders {
		if strings.EqualFold(strings.TrimSpace(order.Renter), renter) && strings.EqualFold(strings.TrimSpace(order.Receiver), receiver) {
			return order, true
		}
	}
	return officialRentOrder{}, false
}

func officialRentalExpiration(now time.Time, order officialRentOrder) (time.Time, error) {
	secondsText := strings.TrimSpace(order.CanRentSeconds)
	if secondsText == "" {
		return time.Time{}, errors.New("missing official canRentSeconds")
	}
	seconds, err := strconv.ParseFloat(secondsText, 64)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse official canRentSeconds: %w", err)
	}
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return time.Time{}, errors.New("invalid official canRentSeconds")
	}
	if seconds < 0 {
		seconds = 0
	}
	return now.Add(time.Duration(seconds * float64(time.Second))), nil
}

func (s *Service) fetchPendingOrders(ctx context.Context) ([]PendingOrder, error) {
	rows, err := s.db.Query(ctx, `
select id, order_no, package_name, receiver_address, energy_amount, duration_hours,
       payment_amount_sun::text, created_at, payment_expires_at, coalesce(remark, '')
from energy_orders
where status = 'pending' and deleted_at is null
order by created_at asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []PendingOrder
	for rows.Next() {
		var order PendingOrder
		var amountText string
		if err := rows.Scan(&order.ID, &order.OrderNo, &order.PackageName, &order.ReceiverAddress, &order.EnergyAmount, &order.DurationHours, &amountText, &order.CreatedAt, &order.PaymentExpiresAt, &order.Remark); err != nil {
			return nil, err
		}
		order.CreatedAt = databaseTimestampAsLocal(order.CreatedAt)
		order.PaymentExpiresAt = databaseTimestampAsLocal(order.PaymentExpiresAt)
		amount, err := strconv.ParseInt(amountText, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse payment amount for order %s: %w", order.OrderNo, err)
		}
		order.PaymentAmountSun = amount
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func (s *Service) fetchPaidOrders(ctx context.Context) ([]PaidOrder, error) {
	rows, err := s.db.Query(ctx, `
select id, order_no, receiver_address, energy_amount, duration_hours,
       coalesce(payment_tx_hash, ''), coalesce(remark, ''),
       coalesce(energy_provider, 'justlend'), coalesce(external_order_id, ''),
       coalesce(external_provider_environment, '')
from energy_orders
where status = 'paid' and deleted_at is null
order by updated_at asc, id asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []PaidOrder
	for rows.Next() {
		var order PaidOrder
		if err := rows.Scan(&order.ID, &order.OrderNo, &order.ReceiverAddress, &order.EnergyAmount, &order.DurationHours, &order.PaymentTxHash, &order.Remark, &order.Provider, &order.ExternalOrderID, &order.ExternalProviderEnvironment); err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func (s *Service) fetchDueReturnTasks(ctx context.Context) ([]ReturnTask, error) {
	rows, err := s.db.Query(ctx, `
select t.id, t.order_id, o.order_no, t.receiver_address, t.energy_amount,
       o.duration_hours, coalesce(t.delegated_amount_sun, 0)::text,
       t.attempts, coalesce(o.remark, '')
from energy_return_tasks t
join energy_orders o on o.id = t.order_id
where t.status = 'pending'
  and coalesce(o.energy_provider, 'justlend') = 'justlend'
  and t.deleted_at is null
  and o.deleted_at is null
  and (t.next_retry_at is null or t.next_retry_at <= $1)
order by coalesce(t.next_retry_at, t.created_at) asc, t.id asc`, time.Now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []ReturnTask
	for rows.Next() {
		var task ReturnTask
		var delegatedText string
		if err := rows.Scan(&task.ID, &task.OrderID, &task.OrderNo, &task.ReceiverAddress, &task.EnergyAmount, &task.DurationHours, &delegatedText, &task.Attempts, &task.Remark); err != nil {
			return nil, err
		}
		delegatedSun, err := strconv.ParseInt(delegatedText, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse delegated amount for return task %d: %w", task.ID, err)
		}
		task.DelegatedAmountSun = delegatedSun
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Service) syncOfficialRentalExpirations(ctx context.Context) error {
	orders, err := s.fetchRentingOrdersForScheduleSync(ctx)
	if err != nil {
		return err
	}
	if len(orders) == 0 {
		return nil
	}

	renter, err := justLendPayerAddress(s.cfg.JustLendPayerPrivateKey)
	if err != nil {
		return err
	}

	for _, order := range orders {
		expiresAt, err := s.fetchOfficialRentalExpiration(ctx, renter, order.ReceiverAddress)
		if err != nil {
			s.logger.Printf("fetch official rental expiration failed: order=%s receiver=%s error=%v", order.OrderNo, order.ReceiverAddress, err)
			continue
		}
		if !order.ExpiresAt.IsZero() && absDuration(order.ExpiresAt.Sub(expiresAt)) <= officialRentalScheduleTolerance {
			continue
		}
		if err := s.updateRentalSchedule(ctx, order.ID, expiresAt); err != nil {
			return err
		}
		s.logger.Printf("official rental expiration synced: order=%s expires_at=%s", order.OrderNo, expiresAt.Format(time.DateTime))
	}
	return nil
}

func (s *Service) fetchRentingOrdersForScheduleSync(ctx context.Context) ([]rentingOrderForScheduleSync, error) {
	rows, err := s.db.Query(ctx, `
select o.id, o.order_no, o.receiver_address,
       coalesce(o.expires_at, timestamp '1970-01-01 00:00:00') as expires_at
from energy_orders o
where o.status = 'renting'
  and o.return_status = 'pending'
  and coalesce(o.energy_provider, 'justlend') = 'justlend'
  and o.deleted_at is null
  and exists (
    select 1
    from energy_return_tasks t
    where t.order_id = o.id
      and t.status = 'pending'
      and t.deleted_at is null
  )
order by o.id asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []rentingOrderForScheduleSync
	for rows.Next() {
		var order rentingOrderForScheduleSync
		if err := rows.Scan(&order.ID, &order.OrderNo, &order.ReceiverAddress, &order.ExpiresAt); err != nil {
			return nil, err
		}
		order.ExpiresAt = databaseTimestampAsLocal(order.ExpiresAt)
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func (s *Service) updateRentalSchedule(ctx context.Context, orderID int, expiresAt time.Time) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	now := time.Now()
	if _, err := tx.Exec(ctx, `
update energy_orders
set expires_at = $1,
    updated_at = $2
where id = $3
  and status = 'renting'
  and return_status = 'pending'
  and deleted_at is null`, expiresAt, now, orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
update energy_return_tasks
set next_retry_at = $1,
    updated_at = $2
where order_id = $3
  and status = 'pending'
  and deleted_at is null`, expiresAt, now, orderID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) markOrderPaid(ctx context.Context, order PendingOrder, transfer IncomingTransfer) (bool, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var existing bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from energy_wallet_transactions where tx_hash = $1 and deleted_at is null)`, transfer.TxID).Scan(&existing); err != nil {
		return false, err
	}
	if existing {
		return false, nil
	}

	var status string
	if err := tx.QueryRow(ctx, `select status from energy_orders where id = $1 for update`, order.ID).Scan(&status); err != nil {
		return false, err
	}
	if status != "pending" {
		return false, nil
	}

	now := time.Now()
	if _, err := tx.Exec(ctx, `
insert into energy_wallet_transactions (
  tx_hash, wallet_address, direction, transaction_type, amount_sun,
  related_order_id, status, confirmed_at, created_at, updated_at
) values ($1, $2, 'in', 'payment', $3, $4, 'success', $5, $6, $6)`,
		transfer.TxID, transfer.FromAddress, transfer.AmountSun, order.ID, transfer.ConfirmedAt, now,
	); err != nil {
		return false, err
	}

	tag, err := tx.Exec(ctx, `
update energy_orders
set buyer_address = $1,
    payment_tx_hash = $2,
    status = 'paid',
    updated_at = $3
where id = $4 and status = 'pending'`,
		transfer.FromAddress, transfer.TxID, now, order.ID,
	)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) markOrderRenting(ctx context.Context, order PaidOrder, txID string, amounts RentalAmounts, expiresAt time.Time, receipt *core.TransactionInfo) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	now := time.Now()
	var status string
	if err := tx.QueryRow(ctx, `select status from energy_orders where id = $1 for update`, order.ID).Scan(&status); err != nil {
		return err
	}
	if status != "paid" {
		return nil
	}

	if _, err := tx.Exec(ctx, `
insert into energy_wallet_transactions (
  tx_hash, wallet_address, direction, transaction_type, amount_sun,
  related_order_id, status, confirmed_at, remark, created_at, updated_at
) values ($1, $2, 'out', 'rent', $3, $4, 'success', $5, $6, $5, $5)`,
		txID,
		s.cfg.JustLendContractAddress,
		amounts.PrepaySun,
		order.ID,
		now,
		fmt.Sprintf("delegated_sun=%d rent_fee_sun=%d", amounts.DelegatedSun, amounts.RentFeeSun),
	); err != nil {
		return err
	}
	if err := insertNetworkFeeWalletTransaction(ctx, tx, txID, s.cfg.JustLendContractAddress, order.ID, receipt, now, "rent contract fee"); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
update energy_orders
set status = 'renting',
    return_status = 'pending',
    rent_tx_hash = $1,
    rented_at = $2,
    expires_at = $3,
    updated_at = $2
where id = $4`,
		txID, now, expiresAt, order.ID,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
insert into energy_return_tasks (
  order_id, receiver_address, energy_amount, delegated_amount_sun,
  status, attempts, next_retry_at, created_at, updated_at
) values ($1, $2, $3, $4, 'pending', 0, $5, $6, $6)`,
		order.ID,
		order.ReceiverAddress,
		order.EnergyAmount,
		amounts.DelegatedSun,
		expiresAt,
		now,
	); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Service) markReturnTaskRunning(ctx context.Context, taskID int) (bool, error) {
	tag, err := s.db.Exec(ctx, `
update energy_return_tasks
set status = 'running', updated_at = $1
where id = $2 and status = 'pending'`, time.Now(), taskID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Service) markReturnTaskCompleted(ctx context.Context, task ReturnTask, txID string, receipt *core.TransactionInfo) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	now := time.Now()
	refundSun, err := justLendRefundToAddressSun(receipt, s.cfg.PlatformReceiveAddress)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
update energy_return_tasks
set status = 'completed',
    last_error = null,
    completed_at = $1,
    updated_at = $1
where id = $2`, now, task.ID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
update energy_orders
set status = 'completed',
    return_status = 'completed',
    returned_at = $1,
    updated_at = $1
where id = $2`, now, task.OrderID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
insert into energy_wallet_transactions (
  tx_hash, wallet_address, direction, transaction_type, amount_sun,
  related_order_id, status, confirmed_at, remark, created_at, updated_at
) values ($1, $2, 'in', 'return', $3, $4, 'success', $5, $6, $5, $5)`,
		txID,
		s.cfg.JustLendContractAddress,
		refundSun,
		task.OrderID,
		now,
		fmt.Sprintf("returned_delegated_sun=%d refund_sun=%d", task.DelegatedAmountSun, refundSun),
	); err != nil {
		return err
	}
	if err := insertNetworkFeeWalletTransaction(ctx, tx, txID, s.cfg.JustLendContractAddress, task.OrderID, receipt, now, "return contract fee"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) markReturnTaskFailed(ctx context.Context, task ReturnTask, cause error) error {
	now := time.Now()
	attempts := task.Attempts + 1
	lastError := cause.Error()
	if attempts >= maxReturnAttempts {
		tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `
update energy_return_tasks
set status = 'failed', attempts = $1, last_error = $2, updated_at = $3
where id = $4`, attempts, lastError, now, task.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
update energy_orders
set return_status = 'failed', updated_at = $1
where id = $2`, now, task.OrderID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	_, err := s.db.Exec(ctx, `
update energy_return_tasks
set status = 'pending',
    attempts = $1,
    last_error = $2,
    next_retry_at = $3,
    updated_at = $4
where id = $5`, attempts, lastError, now.Add(time.Minute), now, task.ID)
	return err
}

func (s *Service) cancelExpiredPendingOrders(ctx context.Context, now time.Time) error {
	orders, err := s.fetchExpiredPendingOrders(ctx, now)
	if err != nil {
		return err
	}
	for _, order := range orders {
		tag, err := s.db.Exec(ctx, `
update energy_orders
set status = 'cancelled', updated_at = $1
where id = $2
  and status = 'pending'
  and deleted_at is null`, now, order.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		s.logger.Printf("payment order expired: order=%s", order.OrderNo)
		s.notifyOrderChat(ctx, order.Remark, expiredOrderMessage(order))
	}
	return nil
}

func (s *Service) fetchExpiredPendingOrders(ctx context.Context, now time.Time) ([]ExpiredOrder, error) {
	rows, err := s.db.Query(ctx, `
select id, order_no, package_name, payment_amount_sun::text, coalesce(remark, '')
from energy_orders
where status = 'pending'
  and deleted_at is null
  and payment_expires_at is not null
  and payment_expires_at < $1
order by payment_expires_at asc, id asc`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []ExpiredOrder
	for rows.Next() {
		var order ExpiredOrder
		var amountText string
		if err := rows.Scan(&order.ID, &order.OrderNo, &order.PackageName, &amountText, &order.Remark); err != nil {
			return nil, err
		}
		amount, err := strconv.ParseInt(amountText, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse expired payment amount for order %s: %w", order.OrderNo, err)
		}
		order.PaymentAmountSun = amount
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func (s *Service) executeJustLend(ctx context.Context, method string, receiver string, delegatedSun int64, callValueSun int64) (string, *core.TransactionInfo, error) {
	privateKeyHex := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(s.cfg.JustLendPayerPrivateKey), "0x"), "0X")
	signerKey, err := keys.GetPrivateKeyFromHex(privateKeyHex)
	if err != nil {
		return "", nil, fmt.Errorf("invalid justlend payer private key")
	}
	signerAddr := address.BTCECPubkeyToAddress(signerKey.PubKey()).String()

	grpcClient := client.NewGrpcClient(tronGRPCEndpoint)
	if strings.TrimSpace(s.cfg.TronAPIKey) != "" {
		if err := grpcClient.SetAPIKey(strings.TrimSpace(s.cfg.TronAPIKey)); err != nil {
			return "", nil, err
		}
	}
	if err := grpcClient.SetContext(ctx); err != nil {
		return "", nil, err
	}
	if err := grpcClient.Start(client.GRPCInsecure()); err != nil {
		return "", nil, err
	}
	defer grpcClient.Stop()

	params := buildJustLendParams(receiver, delegatedSun)
	tx, err := grpcClient.TriggerContract(
		signerAddr,
		s.cfg.JustLendContractAddress,
		method,
		params,
		feeLimitSun,
		callValueSun,
		"",
		0,
	)
	if err != nil {
		return "", nil, err
	}

	signedTx, err := transaction.SignTransaction(tx.Transaction, signerKey)
	if err != nil {
		return "", nil, err
	}
	result, err := grpcClient.Broadcast(signedTx)
	if err != nil {
		return "", nil, err
	}
	if !result.Result || result.Code != api.Return_SUCCESS {
		return "", nil, fmt.Errorf("broadcast failed: (%d) %s", result.Code, string(result.Message))
	}
	txID := fmt.Sprintf("%x", tx.Txid)
	info, err := s.waitForJustLendReceipt(ctx, grpcClient, txID)
	if err != nil {
		return txID, info, err
	}
	return txID, info, nil
}

func justLendPayerAddress(privateKey string) (string, error) {
	privateKeyHex := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(privateKey), "0x"), "0X")
	signerKey, err := keys.GetPrivateKeyFromHex(privateKeyHex)
	if err != nil {
		return "", fmt.Errorf("invalid justlend payer private key")
	}
	return address.BTCECPubkeyToAddress(signerKey.PubKey()).String(), nil
}

func insertNetworkFeeWalletTransaction(ctx context.Context, tx pgx.Tx, txID string, walletAddress string, orderID int, receipt *core.TransactionInfo, confirmedAt time.Time, remark string) error {
	if receipt == nil || receipt.GetFee() <= 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
insert into energy_wallet_transactions (
  tx_hash, wallet_address, direction, transaction_type, amount_sun,
  related_order_id, status, confirmed_at, remark, created_at, updated_at
) values ($1, $2, 'out', 'fee', $3, $4, 'success', $5, $6, $5, $5)`,
		txID,
		walletAddress,
		receipt.GetFee(),
		orderID,
		confirmedAt,
		remark,
	)
	return err
}

func justLendRefundToAddressSun(info *core.TransactionInfo, recipient string) (int64, error) {
	if info == nil {
		return 0, nil
	}
	recipientAddress, err := address.Base58ToAddress(strings.TrimSpace(recipient))
	if err != nil {
		return 0, fmt.Errorf("invalid refund recipient address: %w", err)
	}

	var total int64
	for _, internalTx := range info.GetInternalTransactions() {
		if internalTx.GetRejected() || !bytes.Equal(internalTx.GetTransferToAddress(), recipientAddress) {
			continue
		}
		for _, value := range internalTx.GetCallValueInfo() {
			if strings.TrimSpace(value.GetTokenId()) != "" || value.GetCallValue() <= 0 {
				continue
			}
			total += value.GetCallValue()
		}
	}
	return total, nil
}

func buildJustLendParams(receiver string, delegatedSun int64) string {
	return fmt.Sprintf(`[{"address":"%s"},{"uint256":"%d"},{"uint256":"%d"}]`, receiver, delegatedSun, tronResourceEnergy)
}

func (s *Service) waitForJustLendReceipt(ctx context.Context, grpcClient *client.GrpcClient, txID string) (*core.TransactionInfo, error) {
	waitCtx, cancel := context.WithTimeout(ctx, justLendReceiptWait)
	defer cancel()

	var lastErr error
	ticker := time.NewTicker(justLendReceiptTick)
	defer ticker.Stop()

	for {
		info, err := grpcClient.GetTransactionInfoByIDCtx(waitCtx, txID)
		if err == nil {
			if err := validateJustLendTransactionInfo(txID, info); err != nil {
				return info, err
			}
			return info, nil
		}
		lastErr = err

		select {
		case <-waitCtx.Done():
			return nil, fmt.Errorf("wait justlend transaction receipt %s: %w; last error: %v", txID, waitCtx.Err(), lastErr)
		case <-ticker.C:
		}
	}
}

func validateJustLendTransactionInfo(txID string, info *core.TransactionInfo) error {
	if info == nil {
		return fmt.Errorf("justlend transaction %s receipt not found", txID)
	}

	receiptResult := core.Transaction_Result_DEFAULT
	if receipt := info.GetReceipt(); receipt != nil {
		receiptResult = receipt.GetResult()
	}

	if info.GetResult() != core.TransactionInfo_SUCESS {
		return fmt.Errorf("justlend transaction %s failed: result=%s receipt=%s fee_sun=%d message=%s",
			txID,
			info.GetResult(),
			receiptResult,
			info.GetFee(),
			formatTronMessage(info.GetResMessage()),
		)
	}
	if receiptResult != core.Transaction_Result_DEFAULT && receiptResult != core.Transaction_Result_SUCCESS {
		return fmt.Errorf("justlend transaction %s contract failed: receipt=%s fee_sun=%d message=%s",
			txID,
			receiptResult,
			info.GetFee(),
			formatTronMessage(info.GetResMessage()),
		)
	}
	return nil
}

func formatTronMessage(message []byte) string {
	text := strings.TrimSpace(string(message))
	if text != "" {
		return text
	}
	if len(message) == 0 {
		return ""
	}
	return fmt.Sprintf("%x", message)
}

func (s *Service) notifyOrderChat(ctx context.Context, remark string, text string) {
	chatID, ok := parseTelegramChatID(remark)
	if !ok || strings.TrimSpace(s.cfg.TelegramBotToken) == "" {
		return
	}
	if err := s.sendTelegramMessage(ctx, chatID, text); err != nil {
		s.logger.Printf("telegram notify failed: %v", err)
	}
}

func (s *Service) sendTelegramMessage(ctx context.Context, chatID int64, text string) error {
	payload, err := json.Marshal(map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_web_page_preview": true,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+s.cfg.TelegramBotToken+"/sendMessage", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return errors.New(redactTelegramToken(err.Error(), s.cfg.TelegramBotToken))
	}
	defer resp.Body.Close()
	var body struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}
	if !body.OK {
		if strings.TrimSpace(body.Description) == "" {
			body.Description = resp.Status
		}
		return fmt.Errorf("telegram sendMessage failed: %s", body.Description)
	}
	return nil
}

func rentalAmountsFromDashboard(energyAmount int, duration time.Duration, dashboard Dashboard) (RentalAmounts, error) {
	if energyAmount <= 0 {
		return RentalAmounts{}, errors.New("energy amount must be positive")
	}
	if duration <= 0 {
		return RentalAmounts{}, errors.New("duration must be positive")
	}
	energyRentPerTrx, err := positiveDashboardNumber(dashboard.EnergyRentPerTrx, "energyRentPerTrx")
	if err != nil {
		return RentalAmounts{}, err
	}
	energyStakePerTrx, err := positiveDashboardNumber(dashboard.EnergyStakePerTrx, "energyStakePerTrx")
	if err != nil {
		return RentalAmounts{}, err
	}

	energy := float64(energyAmount)
	durationHours := duration.Hours()
	delegatedTrx := energy / energyStakePerTrx
	rentFeeTrx := (energy / energyRentPerTrx) * (durationHours / 24)
	securityDepositTrx := energy / energyRentPerTrx
	liquidationReserveTrx := math.Max(delegatedTrx*0.00008, 20)
	totalPrepayTrx := rentFeeTrx + securityDepositTrx + liquidationReserveTrx

	return RentalAmounts{
		DelegatedSun: trxToSunCeil(delegatedTrx),
		PrepaySun:    trxToSunCeil(totalPrepayTrx),
		RentFeeSun:   trxToSunCeil(rentFeeTrx),
	}, nil
}

func findMatchingOrder(transfer IncomingTransfer, orders []PendingOrder) (PendingOrder, bool) {
	if transfer.AmountSun <= 0 || transfer.TxID == "" {
		return PendingOrder{}, false
	}
	matches := make([]PendingOrder, 0, 1)
	for _, order := range orders {
		if order.PaymentAmountSun != transfer.AmountSun {
			continue
		}
		if transfer.ConfirmedAt.Before(order.CreatedAt.Add(-30 * time.Second)) {
			continue
		}
		if transfer.ConfirmedAt.After(order.PaymentExpiresAt.Add(5 * time.Second)) {
			continue
		}
		matches = append(matches, order)
	}
	if len(matches) != 1 {
		return PendingOrder{}, false
	}
	return matches[0], true
}

func parseTronGridTransfers(response tronGridTransactionsResponse, platformAddress string) []IncomingTransfer {
	platformAddress = strings.TrimSpace(platformAddress)
	transfers := make([]IncomingTransfer, 0, len(response.Data))
	for _, tx := range response.Data {
		if tx.TxID == "" || !isSuccessfulTRXTransfer(tx) {
			continue
		}
		for _, contract := range tx.RawData.Contract {
			if contract.Type != "TransferContract" {
				continue
			}
			value := contract.Parameter.Value
			if value.Amount <= 0 || value.ToAddress == "" || value.OwnerAddress == "" {
				continue
			}
			to, err := tronHexToBase58(value.ToAddress)
			if err != nil || !strings.EqualFold(to, platformAddress) {
				continue
			}
			from, err := tronHexToBase58(value.OwnerAddress)
			if err != nil {
				continue
			}
			transfers = append(transfers, IncomingTransfer{
				TxID:        tx.TxID,
				FromAddress: from,
				ToAddress:   to,
				AmountSun:   value.Amount,
				ConfirmedAt: time.UnixMilli(tx.BlockTimestamp).In(time.Local),
			})
		}
	}
	return transfers
}

func isSuccessfulTRXTransfer(tx tronGridTransaction) bool {
	if len(tx.Ret) == 0 {
		return false
	}
	if !strings.EqualFold(tx.Ret[0].ContractRet, "SUCCESS") {
		return false
	}
	for _, contract := range tx.RawData.Contract {
		if contract.Type == "TransferContract" {
			return true
		}
	}
	return false
}

func tronHexToBase58(value string) (string, error) {
	addr, err := address.HexToAddress(value)
	if err != nil {
		return "", err
	}
	return addr.String(), nil
}

func positiveDashboardNumber(value any, fieldName string) (float64, error) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0, fmt.Errorf("invalid %s: %w", fieldName, err)
		}
		if parsed <= 0 {
			return 0, fmt.Errorf("invalid %s: must be positive", fieldName)
		}
		return parsed, nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0, fmt.Errorf("invalid %s: %w", fieldName, err)
		}
		if parsed <= 0 {
			return 0, fmt.Errorf("invalid %s: must be positive", fieldName)
		}
		return parsed, nil
	case float64:
		if typed <= 0 {
			return 0, fmt.Errorf("invalid %s: must be positive", fieldName)
		}
		return typed, nil
	case int:
		if typed <= 0 {
			return 0, fmt.Errorf("invalid %s: must be positive", fieldName)
		}
		return float64(typed), nil
	default:
		return 0, fmt.Errorf("invalid %s", fieldName)
	}
}

func trxToSunCeil(value float64) int64 {
	return int64(math.Ceil(value * 1_000_000))
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}

func databaseTimestampAsLocal(value time.Time) time.Time {
	if value.IsZero() {
		return value
	}
	return time.Date(
		value.Year(),
		value.Month(),
		value.Day(),
		value.Hour(),
		value.Minute(),
		value.Second(),
		value.Nanosecond(),
		time.Local,
	)
}

func formatTRX(sun int64) string {
	whole := sun / 1_000_000
	fraction := sun % 1_000_000
	if fraction == 0 {
		return strconv.FormatInt(whole, 10)
	}
	return strings.TrimRight(fmt.Sprintf("%d.%06d", whole, fraction), "0")
}

func expiredOrderMessage(order ExpiredOrder) string {
	return strings.Join([]string{
		"⚠️ 订单已过期",
		"",
		fmt.Sprintf("订单号：%s", order.OrderNo),
		fmt.Sprintf("套餐：%s", order.PackageName),
		fmt.Sprintf("原应付：%s TRX", formatTRX(order.PaymentAmountSun)),
		"",
		"请不要再转账到这笔订单的收款地址。",
		"如需继续租赁能量，请重新生成订单后再付款。",
		"如果你已经转账，请先不要重复付款，联系管理员核对交易哈希。",
	}, "\n")
}

func parseTelegramChatID(remark string) (int64, bool) {
	for _, part := range strings.Split(remark, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || strings.TrimSpace(key) != "telegram_chat_id" {
			continue
		}
		chatID, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		return chatID, err == nil
	}
	return 0, false
}

func redactTelegramToken(message string, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return message
	}
	return strings.ReplaceAll(message, "/bot"+token+"/", "/bot[redacted]/")
}
