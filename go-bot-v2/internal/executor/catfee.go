package executor

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	catFeeProviderName                = "catfee"
	catFeeDuration1h                  = "1h"
	catFeeProviderManagedReturnStatus = "provider_managed"
)

type catFeeOrderDetail struct {
	ID                string `json:"id"`
	ClientOrderID     string `json:"client_order_id"`
	Receiver          string `json:"receiver"`
	DelegateHash      string `json:"delegate_hash"`
	DelegateTimestamp int64  `json:"delegate_timestamp"`
	ReclaimHash       string `json:"reclaim_hash"`
	ReclaimTimestamp  int64  `json:"reclaim_timestamp"`
	PayAmountSun      int64  `json:"pay_amount_sun"`
	ActivateAmountSun int64  `json:"activate_amount_sun"`
	Quantity          int    `json:"quantity"`
	StakedSun         int64  `json:"staked_sun"`
	Duration          int64  `json:"duration"`
	ExpiredTimestamp  int64  `json:"expired_timestamp"`
	Status            string `json:"status"`
	ActivateStatus    string `json:"activate_status"`
	ConfirmStatus     string `json:"confirm_status"`
	Balance           int64  `json:"balance"`
}

type catFeeTrackedOrder struct {
	ID                          int
	OrderNo                     string
	ExternalOrderID             string
	ExternalProviderEnvironment string
	Remark                      string
}

func (s *Service) processCatFeePaidOrder(ctx context.Context, order PaidOrder) error {
	detail, err := s.loadOrCreateCatFeeOrder(ctx, order)
	if err != nil {
		return err
	}
	if catFeeOrderFailed(detail) {
		if err := s.markCatFeeOrderFailed(ctx, order.ID, order.ExternalProviderEnvironment, detail); err != nil {
			return err
		}
		s.notifyOrderChat(ctx, order.Remark, fmt.Sprintf("❌ 能量下发失败\n\n订单号：%s\n服务商订单：%s\n状态：%s", order.OrderNo, detail.ID, detail.Status))
		return nil
	}
	if !catFeeDelegationConfirmed(detail) {
		return s.markCatFeeOrderDelegating(ctx, order, detail)
	}

	if err := s.markCatFeeOrderRenting(ctx, order, detail); err != nil {
		return err
	}
	txID := catFeeTransactionID(detail)
	s.logger.Printf("catfee energy rented: order=%s external_order=%s tx=%s cost_sun=%d", order.OrderNo, detail.ID, txID, detail.providerCostSun())
	s.notifyOrderChat(ctx, order.Remark, fmt.Sprintf("⚡ 能量已下发\n\n订单号：%s\n能量数量：%d\n租赁时长：%d 小时\n服务商订单：%s\n链上交易：%s\n\n到期后由 CatFee 自动回收。", order.OrderNo, order.EnergyAmount, order.DurationHours, detail.ID, txID))
	return nil
}

func (s *Service) loadOrCreateCatFeeOrder(ctx context.Context, order PaidOrder) (catFeeOrderDetail, error) {
	environment := catFeeOrderEnvironment(order.ExternalProviderEnvironment, s.cfg.CatFeeEnvironment)
	if strings.TrimSpace(order.ExternalOrderID) != "" {
		return s.fetchCatFeeOrder(ctx, order.ExternalOrderID, environment)
	}
	if order.DurationHours != 1 {
		return catFeeOrderDetail{}, fmt.Errorf("catfee only supports 1h duration, got %d", order.DurationHours)
	}
	return s.createCatFeeOrder(ctx, order, environment)
}

func (s *Service) createCatFeeOrder(ctx context.Context, order PaidOrder, environment string) (catFeeOrderDetail, error) {
	values := catFeeOrderQuery(order.EnergyAmount, order.ReceiverAddress, order.DurationHours, order.OrderNo, s.cfg.CatFeeAutoActivate)
	var detail catFeeOrderDetail
	if err := s.catFeeRequest(ctx, environment, http.MethodPost, "/v1/order", values, &detail); err != nil {
		return catFeeOrderDetail{}, err
	}
	if strings.TrimSpace(detail.ID) == "" {
		return catFeeOrderDetail{}, errors.New("catfee create order returned empty id")
	}
	return detail, nil
}

func (s *Service) fetchCatFeeOrder(ctx context.Context, orderID string, environment string) (catFeeOrderDetail, error) {
	path := "/v1/order/" + url.PathEscape(strings.TrimSpace(orderID))
	var detail catFeeOrderDetail
	if err := s.catFeeRequest(ctx, environment, http.MethodGet, path, nil, &detail); err != nil {
		return catFeeOrderDetail{}, err
	}
	return detail, nil
}

func (s *Service) syncCatFeeRentingOrders(ctx context.Context) error {
	orders, err := s.fetchCatFeeRentingOrders(ctx)
	if err != nil {
		return err
	}
	for _, order := range orders {
		detail, err := s.fetchCatFeeOrder(ctx, order.ExternalOrderID, order.ExternalProviderEnvironment)
		if err != nil {
			s.logger.Printf("fetch catfee order failed: order=%s external_order=%s error=%v", order.OrderNo, order.ExternalOrderID, err)
			continue
		}
		if catFeeOrderCompleted(detail) {
			if err := s.markCatFeeOrderCompleted(ctx, order.ID, detail); err != nil {
				return err
			}
			s.notifyOrderChat(ctx, order.Remark, fmt.Sprintf("✅ 能量租赁已结束\n\n订单号：%s\n服务商订单：%s\n回收交易：%s", order.OrderNo, detail.ID, strings.TrimSpace(detail.ReclaimHash)))
			continue
		}
		if catFeeOrderFailed(detail) {
			if err := s.markCatFeeOrderFailed(ctx, order.ID, order.ExternalProviderEnvironment, detail); err != nil {
				return err
			}
			continue
		}
		if err := s.updateCatFeeOrderStatus(ctx, order.ID, detail); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) catFeeRequest(ctx context.Context, environment string, method string, path string, values url.Values, out any) error {
	environment = catFeeOrderEnvironment(environment, s.cfg.CatFeeEnvironment)
	baseURL := strings.TrimRight(s.cfg.CatFeeAPIBaseURLFor(environment), "/")
	if baseURL == "" {
		return errors.New("catfee api base url is required")
	}
	apiKey := s.cfg.CatFeeAPIKeyFor(environment)
	apiSecret := s.cfg.CatFeeAPISecretFor(environment)
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(apiSecret) == "" {
		return fmt.Errorf("catfee %s api key/secret is required", environment)
	}
	requestPath := buildCatFeeRequestPath(path, values)
	timestamp := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	signature := catFeeSignature(timestamp, method, requestPath, apiSecret)

	req, err := http.NewRequestWithContext(ctx, method, baseURL+requestPath, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-ACCESS-KEY", apiKey)
	req.Header.Set("CF-ACCESS-SIGN", signature)
	req.Header.Set("CF-ACCESS-TIMESTAMP", timestamp)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("catfee %s %s failed: %s %s", method, requestPath, resp.Status, strings.TrimSpace(string(body)))
	}

	var envelope struct {
		Code    any             `json:"code"`
		Msg     string          `json:"msg"`
		SubCode string          `json:"sub_code"`
		SubMsg  string          `json:"sub_msg"`
		Data    json.RawMessage `json:"data"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.UseNumber()
	if err := decoder.Decode(&envelope); err != nil {
		return err
	}
	if code := catFeeCode(envelope.Code); code != 0 {
		message := strings.TrimSpace(envelope.SubMsg)
		if message == "" {
			message = strings.TrimSpace(envelope.Msg)
		}
		if message == "" {
			message = strconv.Itoa(code)
		}
		return fmt.Errorf("catfee returned code %d: %s", code, message)
	}
	if out == nil || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil
	}
	return json.Unmarshal(envelope.Data, out)
}

func (s *Service) fetchCatFeeRentingOrders(ctx context.Context) ([]catFeeTrackedOrder, error) {
	rows, err := s.db.QueryContext(ctx, `
select id, order_no, coalesce(external_order_id, ''),
       coalesce(external_provider_environment, ''),
       coalesce(remark, '')
from energy_orders
where status = 'renting'
  and coalesce(energy_provider, 'justlend') = 'catfee'
  and coalesce(external_order_id, '') <> ''
  and deleted_at is null
order by id asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []catFeeTrackedOrder
	for rows.Next() {
		var order catFeeTrackedOrder
		if err := rows.Scan(&order.ID, &order.OrderNo, &order.ExternalOrderID, &order.ExternalProviderEnvironment, &order.Remark); err != nil {
			return nil, err
		}
		order.ExternalProviderEnvironment = catFeeOrderEnvironment(order.ExternalProviderEnvironment, s.cfg.CatFeeEnvironment)
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func (s *Service) markCatFeeOrderDelegating(ctx context.Context, order PaidOrder, detail catFeeOrderDetail) error {
	environment := catFeeOrderEnvironment(order.ExternalProviderEnvironment, s.cfg.CatFeeEnvironment)
	_, err := s.db.ExecContext(ctx, `
update energy_orders
set external_order_id = ?1,
    external_status = ?2,
    external_confirm_status = ?3,
    provider_cost_sun = ?4,
    external_provider_environment = ?5,
    updated_at = ?6
where id = ?7
  and status = 'paid'`,
		detail.ID,
		detail.Status,
		detail.ConfirmStatus,
		detail.providerCostSun(),
		environment,
		time.Now(),
		order.ID,
	)
	return err
}

func (s *Service) markCatFeeOrderRenting(ctx context.Context, order PaidOrder, detail catFeeOrderDetail) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var status string
	if err := tx.QueryRowContext(ctx, `select status from energy_orders where id = ?1`, order.ID).Scan(&status); err != nil {
		return err
	}
	if status != "paid" {
		return nil
	}

	now := time.Now()
	environment := catFeeOrderEnvironment(order.ExternalProviderEnvironment, s.cfg.CatFeeEnvironment)
	txID := catFeeTransactionID(detail)
	costSun := detail.providerCostSun()
	expiresAt := detail.expiredAt(now.Add(time.Duration(order.DurationHours) * time.Hour))
	if _, err := tx.ExecContext(ctx, `
insert into energy_wallet_transactions (
  tx_hash, wallet_address, direction, transaction_type, amount_sun,
  related_order_id, status, confirmed_at, remark, created_at, updated_at
) values (?1, ?2, 'out', 'rent', ?3, ?4, 'success', ?5, ?6, ?5, ?5)`,
		txID,
		"CatFee:"+environment,
		costSun,
		order.ID,
		now,
		fmt.Sprintf("catfee_order_id=%s status=%s confirm_status=%s pay_amount_sun=%d activate_amount_sun=%d", detail.ID, detail.Status, detail.ConfirmStatus, detail.PayAmountSun, detail.ActivateAmountSun),
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
update energy_orders
set status = 'renting',
    return_status = ?1,
    rent_tx_hash = ?2,
    external_order_id = ?3,
    external_status = ?4,
    external_confirm_status = ?5,
    provider_cost_sun = ?6,
    external_provider_environment = ?7,
    rented_at = ?8,
    expires_at = ?9,
    updated_at = ?8
where id = ?10`,
		catFeeActiveReturnStatus(),
		txID,
		detail.ID,
		detail.Status,
		detail.ConfirmStatus,
		costSun,
		environment,
		now,
		expiresAt,
		order.ID,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) markCatFeeOrderCompleted(ctx context.Context, orderID int, detail catFeeOrderDetail) error {
	completedAt := time.Now()
	if detail.ReclaimTimestamp > 0 {
		completedAt = time.Unix(detail.ReclaimTimestamp, 0).In(time.Local)
	}
	_, err := s.db.ExecContext(ctx, `
update energy_orders
set status = 'completed',
    return_status = 'completed',
    external_status = ?1,
    external_confirm_status = ?2,
    returned_at = ?3,
    updated_at = ?4
where id = ?5
  and status = 'renting'`,
		detail.Status,
		detail.ConfirmStatus,
		completedAt,
		time.Now(),
		orderID,
	)
	return err
}

func (s *Service) markCatFeeOrderFailed(ctx context.Context, orderID int, environment string, detail catFeeOrderDetail) error {
	environment = catFeeOrderEnvironment(environment, s.cfg.CatFeeEnvironment)
	_, err := s.db.ExecContext(ctx, `
update energy_orders
set status = 'failed',
    return_status = case when return_status in ('pending', ?1) then 'failed' else return_status end,
    external_order_id = coalesce(nullif(?2, ''), external_order_id),
    external_status = ?3,
    external_confirm_status = ?4,
    provider_cost_sun = ?5,
    external_provider_environment = coalesce(nullif(?6, ''), external_provider_environment),
    updated_at = ?7
where id = ?8
  and status in ('paid', 'renting')`,
		catFeeActiveReturnStatus(),
		detail.ID,
		detail.Status,
		detail.ConfirmStatus,
		detail.providerCostSun(),
		environment,
		time.Now(),
		orderID,
	)
	return err
}

func (s *Service) updateCatFeeOrderStatus(ctx context.Context, orderID int, detail catFeeOrderDetail) error {
	_, err := s.db.ExecContext(ctx, `
update energy_orders
set external_status = ?1,
    external_confirm_status = ?2,
    provider_cost_sun = ?3,
    updated_at = ?4
where id = ?5`,
		detail.Status,
		detail.ConfirmStatus,
		detail.providerCostSun(),
		time.Now(),
		orderID,
	)
	return err
}

func catFeeOrderQuery(quantity int, receiver string, durationHours int, clientOrderID string, activate bool) url.Values {
	values := url.Values{}
	values.Set("activate", strconv.FormatBool(activate))
	values.Set("duration", fmt.Sprintf("%dh", durationHours))
	values.Set("quantity", strconv.Itoa(quantity))
	values.Set("receiver", strings.TrimSpace(receiver))
	if strings.TrimSpace(clientOrderID) != "" {
		values.Set("client_order_id", strings.TrimSpace(clientOrderID))
	}
	return values
}

func buildCatFeeRequestPath(path string, values url.Values) string {
	if len(values) == 0 {
		return path
	}
	return path + "?" + values.Encode()
}

func catFeeSignature(timestamp string, method string, requestPath string, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + strings.ToUpper(method) + requestPath))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func catFeeCode(value any) int {
	switch typed := value.(type) {
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(typed))
		return parsed
	default:
		return -1
	}
}

func (detail catFeeOrderDetail) providerCostSun() int64 {
	return detail.PayAmountSun + detail.ActivateAmountSun
}

func (detail catFeeOrderDetail) expiredAt(fallback time.Time) time.Time {
	if detail.ExpiredTimestamp <= 0 {
		return fallback
	}
	return time.Unix(detail.ExpiredTimestamp, 0).In(time.Local)
}

func catFeeDelegationConfirmed(detail catFeeOrderDetail) bool {
	return strings.EqualFold(detail.Status, "DELEGATE_SUCCESS") &&
		strings.EqualFold(detail.ConfirmStatus, "DELEGATION_CONFIRMED")
}

func catFeeOrderFailed(detail catFeeOrderDetail) bool {
	status := strings.ToUpper(strings.TrimSpace(detail.Status))
	confirmStatus := strings.ToUpper(strings.TrimSpace(detail.ConfirmStatus))
	return strings.Contains(status, "FAIL") ||
		strings.Contains(status, "CANCEL") ||
		strings.Contains(confirmStatus, "FAIL")
}

func catFeeOrderCompleted(detail catFeeOrderDetail) bool {
	status := strings.ToUpper(strings.TrimSpace(detail.Status))
	return strings.Contains(status, "RECLAIM_SUCCESS") ||
		strings.Contains(status, "DONE") ||
		strings.Contains(status, "COMPLETE")
}

func catFeeActiveReturnStatus() string {
	return catFeeProviderManagedReturnStatus
}

func catFeeFailureReturnStatus(current string) string {
	switch strings.TrimSpace(current) {
	case "pending", catFeeProviderManagedReturnStatus:
		return "failed"
	default:
		return current
	}
}

func catFeeOrderEnvironment(orderEnvironment string, activeEnvironment string) string {
	environment := strings.ToLower(strings.TrimSpace(orderEnvironment))
	if environment == "" {
		environment = strings.ToLower(strings.TrimSpace(activeEnvironment))
	}
	if environment == "prod" || environment == "production" || environment == "mainnet" {
		return "prod"
	}
	return "nile"
}

func catFeeTransactionID(detail catFeeOrderDetail) string {
	if strings.TrimSpace(detail.DelegateHash) != "" {
		return strings.TrimSpace(detail.DelegateHash)
	}
	return "catfee:" + strings.TrimSpace(detail.ID)
}

func normalizeProviderName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "justlend"
	}
	return value
}
