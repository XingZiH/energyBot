package executor

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fbsobreira/gotron-sdk/pkg/address"

	"github.com/anomalyco/energybot-bot/internal/config"
)

type Service struct {
	cfg        config.Config
	db         *sql.DB
	httpClient *http.Client
	logger     *log.Logger
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
	ExternalOrderID             string
	ExternalProviderEnvironment string
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

func New(cfg config.Config, db *sql.DB, logger *log.Logger) (*Service, error) {
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
	for _, order := range orders {
		if err := s.processCatFeePaidOrder(ctx, order); err != nil {
			s.logger.Printf("catfee rent energy failed: order=%s error=%v", order.OrderNo, err)
		}
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

func (s *Service) fetchPendingOrders(ctx context.Context) ([]PendingOrder, error) {
	rows, err := s.db.QueryContext(ctx, `
select id, order_no, package_name, receiver_address, energy_amount, duration_hours,
       payment_amount_sun, created_at, payment_expires_at, coalesce(remark, '')
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
	rows, err := s.db.QueryContext(ctx, `
select id, order_no, receiver_address, energy_amount, duration_hours,
       coalesce(payment_tx_hash, ''), coalesce(remark, ''),
       coalesce(external_order_id, ''),
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
		if err := rows.Scan(&order.ID, &order.OrderNo, &order.ReceiverAddress, &order.EnergyAmount, &order.DurationHours, &order.PaymentTxHash, &order.Remark, &order.ExternalOrderID, &order.ExternalProviderEnvironment); err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func (s *Service) markOrderPaid(ctx context.Context, order PendingOrder, transfer IncomingTransfer) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var existing bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from energy_wallet_transactions where tx_hash = ?1 and deleted_at is null)`, transfer.TxID).Scan(&existing); err != nil {
		return false, err
	}
	if existing {
		return false, nil
	}

	var status string
	if err := tx.QueryRowContext(ctx, `select status from energy_orders where id = ?1`, order.ID).Scan(&status); err != nil {
		return false, err
	}
	if status != "pending" {
		return false, nil
	}

	now := time.Now()
	if _, err := tx.ExecContext(ctx, `
insert into energy_wallet_transactions (
  tx_hash, wallet_address, direction, transaction_type, amount_sun,
  related_order_id, status, confirmed_at, created_at, updated_at
) values (?1, ?2, 'in', 'payment', ?3, ?4, 'success', ?5, ?6, ?6)`,
		transfer.TxID, transfer.FromAddress, transfer.AmountSun, order.ID, transfer.ConfirmedAt, now,
	); err != nil {
		return false, err
	}

	tag, err := tx.ExecContext(ctx, `
update energy_orders
set buyer_address = ?1,
    payment_tx_hash = ?2,
    status = 'paid',
    updated_at = ?3
where id = ?4 and status = 'pending'`,
		transfer.FromAddress, transfer.TxID, now, order.ID,
	)
	if err != nil {
		return false, err
	}
	rowsAffected, err := tag.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return false, nil
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) cancelExpiredPendingOrders(ctx context.Context, now time.Time) error {
	orders, err := s.fetchExpiredPendingOrders(ctx, now)
	if err != nil {
		return err
	}
	for _, order := range orders {
		tag, err := s.db.ExecContext(ctx, `
update energy_orders
set status = 'cancelled', updated_at = ?1
where id = ?2
  and status = 'pending'
  and deleted_at is null`, now, order.ID)
		if err != nil {
			return err
		}
		rowsAffected, err := tag.RowsAffected()
		if err != nil {
			return fmt.Errorf("rows affected: %w", err)
		}
		if rowsAffected == 0 {
			continue
		}
		s.logger.Printf("payment order expired: order=%s", order.OrderNo)
		s.notifyOrderChat(ctx, order.Remark, expiredOrderMessage(order))
	}
	return nil
}

func (s *Service) fetchExpiredPendingOrders(ctx context.Context, now time.Time) ([]ExpiredOrder, error) {
	rows, err := s.db.QueryContext(ctx, `
select id, order_no, package_name, payment_amount_sun, coalesce(remark, '')
from energy_orders
where status = 'pending'
  and deleted_at is null
  and payment_expires_at is not null
  and payment_expires_at < ?1
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
