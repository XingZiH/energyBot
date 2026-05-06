package executor

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestFindMatchingOrderRequiresSingleCandidate(t *testing.T) {
	now := time.Date(2026, 4, 28, 20, 40, 0, 0, time.UTC)
	transfer := IncomingTransfer{TxID: "tx-1", AmountSun: 2_000_000, ConfirmedAt: now}
	orders := []PendingOrder{
		{ID: 1, PaymentAmountSun: 2_000_000, CreatedAt: now.Add(-time.Minute), PaymentExpiresAt: now.Add(time.Minute)},
		{ID: 2, PaymentAmountSun: 2_000_000, CreatedAt: now.Add(-time.Minute), PaymentExpiresAt: now.Add(time.Minute)},
	}

	_, ok := findMatchingOrder(transfer, orders)

	if ok {
		t.Fatal("ambiguous equal-amount payments must not be auto matched")
	}
}

func TestFindMatchingOrderUsesLocalDatabaseWallClock(t *testing.T) {
	local := time.FixedZone("CST", 8*60*60)
	transfer := IncomingTransfer{
		TxID:        "tx-paid",
		AmountSun:   2_000_000,
		ConfirmedAt: time.Date(2026, 4, 28, 21, 46, 12, 0, local),
	}
	orders := []PendingOrder{
		{
			ID:               1,
			PaymentAmountSun: 2_000_000,
			CreatedAt:        databaseTimestampAsLocal(time.Date(2026, 4, 28, 21, 43, 51, 0, time.UTC)),
			PaymentExpiresAt: databaseTimestampAsLocal(time.Date(2026, 4, 28, 21, 53, 51, 0, time.UTC)),
		},
	}

	order, ok := findMatchingOrder(transfer, orders)

	if !ok || order.ID != 1 {
		t.Fatalf("expected local wall-clock timestamp to match, ok=%v order=%+v", ok, order)
	}
}

func TestExpiredOrderMessageWarnsUserNotToPay(t *testing.T) {
	text := expiredOrderMessage(ExpiredOrder{
		OrderNo:          "ER20260428203210C19DE4",
		PackageName:      "13万能量/1小时",
		PaymentAmountSun: 2_000_000,
	})

	for _, want := range []string{"订单已过期", "不要再转账", "重新生成订单", "ER20260428203210C19DE4"} {
		if !strings.Contains(text, want) {
			t.Fatalf("expired message missing %q: %s", want, text)
		}
	}
}

func TestParseTronGridTransfersKeepsSuccessfulTRXIncomingTransfers(t *testing.T) {
	body := []byte(`{
	  "data": [
	    {
	      "txID": "tx-ok",
	      "block_timestamp": 1777373862000,
	      "ret": [{"contractRet": "SUCCESS"}],
	      "raw_data": {
	        "contract": [{
	          "type": "TransferContract",
	          "parameter": {
	            "value": {
	              "amount": 2000000,
	              "owner_address": "413fe0c0b92765b53e8305cf9f3b8142330a392afa",
	              "to_address": "41718b3c81a25a01fe7b752d7a00c2fb73f9b4cc87"
	            }
	          }
	        }]
	      }
	    },
	    {
	      "txID": "tx-fail",
	      "ret": [{"contractRet": "REVERT"}],
	      "raw_data": {"contract": []}
	    }
	  ]
	}`)
	var response tronGridTransactionsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	transfers := parseTronGridTransfers(response, "TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk")

	if len(transfers) != 1 {
		t.Fatalf("expected one transfer, got %d", len(transfers))
	}
	if transfers[0].TxID != "tx-ok" || transfers[0].AmountSun != 2_000_000 {
		t.Fatalf("unexpected transfer: %+v", transfers[0])
	}
	if transfers[0].FromAddress == "" || transfers[0].ToAddress != "TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk" {
		t.Fatalf("unexpected addresses: %+v", transfers[0])
	}
}

func TestCatFeeSignatureIncludesSortedQueryString(t *testing.T) {
	values := catFeeOrderQuery(130000, "TXYZ", 1, "ER001", true)
	requestPath := buildCatFeeRequestPath("/v1/order", values)

	if requestPath != "/v1/order?activate=true&client_order_id=ER001&duration=1h&quantity=130000&receiver=TXYZ" {
		t.Fatalf("unexpected request path: %s", requestPath)
	}

	signature := catFeeSignature("2023-08-26T12:34:56.789Z", "POST", requestPath, "secret")

	if signature != "kSx2yJjr13pf7hSp3maYPIEJr618x/+aVH9i/8hU6Oo=" {
		t.Fatalf("unexpected signature: %s", signature)
	}
}

func TestCatFeeProviderCostIncludesActivationFee(t *testing.T) {
	detail := catFeeOrderDetail{
		PayAmountSun:      2_000_000,
		ActivateAmountSun: 1_000_000,
	}

	if got := detail.providerCostSun(); got != 3_000_000 {
		t.Fatalf("expected total provider cost 3000000, got %d", got)
	}
}

func TestCatFeeLifecycleRequiresDelegationConfirmation(t *testing.T) {
	if !catFeeDelegationConfirmed(catFeeOrderDetail{Status: "DELEGATE_SUCCESS", ConfirmStatus: "DELEGATION_CONFIRMED"}) {
		t.Fatal("expected confirmed delegation to be treated as rented")
	}
	if catFeeDelegationConfirmed(catFeeOrderDetail{Status: "DELEGATE_SUCCESS", ConfirmStatus: "UNCONFIRMED"}) {
		t.Fatal("unconfirmed delegation must not be treated as rented")
	}
	if !catFeeOrderFailed(catFeeOrderDetail{Status: "DELEGATE_FAILED"}) {
		t.Fatal("delegate failure must be treated as failed")
	}
}

func TestCatFeeRentingOrdersAreProviderManaged(t *testing.T) {
	source, err := os.ReadFile("catfee.go")
	if err != nil {
		t.Fatalf("read catfee.go: %v", err)
	}
	if strings.Contains(string(source), "return_status = 'pending'") {
		t.Fatal("CatFee renting orders must not be marked as pending manual return")
	}
	if got := catFeeActiveReturnStatus(); got != "provider_managed" {
		t.Fatalf("unexpected active CatFee return status: %s", got)
	}
	if got := catFeeFailureReturnStatus("provider_managed"); got != "failed" {
		t.Fatalf("CatFee provider-managed return status should become failed on provider failure, got %s", got)
	}
}

func TestCatFeeOrderEnvironmentIsPersistedAndSyncedIndependently(t *testing.T) {
	if got := catFeeOrderEnvironment("nile", "prod"); got != "nile" {
		t.Fatalf("order environment must win over active config, got %s", got)
	}
	if got := catFeeOrderEnvironment("", "prod"); got != "prod" {
		t.Fatalf("empty order environment should fall back to active config, got %s", got)
	}
}
