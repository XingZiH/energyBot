package executor

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fbsobreira/gotron-sdk/pkg/address"
	"github.com/fbsobreira/gotron-sdk/pkg/proto/core"
)

func TestRentalAmountsFromDashboard(t *testing.T) {
	amounts, err := rentalAmountsFromDashboard(130000, time.Hour, Dashboard{
		EnergyRentPerTrx:  "10000",
		EnergyStakePerTrx: "10",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if amounts.DelegatedSun != 13_000_000_000 {
		t.Fatalf("unexpected delegated sun: %d", amounts.DelegatedSun)
	}
	if amounts.PrepaySun != 33_541_667 {
		t.Fatalf("unexpected prepay sun: %d", amounts.PrepaySun)
	}
}

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

func TestBuildJustLendParamsUsesUint256ResourceType(t *testing.T) {
	params := buildJustLendParams("TNV4d8hvJz7h9XEK9DeRYG4H2YFXChNLAV", 14_152_946_059)
	want := `[{"address":"TNV4d8hvJz7h9XEK9DeRYG4H2YFXChNLAV"},{"uint256":"14152946059"},{"uint256":"1"}]`

	if params != want {
		t.Fatalf("unexpected params: %s", params)
	}
	if strings.Contains(params, "uint32") {
		t.Fatalf("JustLend resourceType must be uint256, got %s", params)
	}
}

func TestValidateJustLendTransactionInfoRejectsFailedReceipt(t *testing.T) {
	err := validateJustLendTransactionInfo("tx-fail", &core.TransactionInfo{
		Result:     core.TransactionInfo_FAILED,
		Fee:        7_500,
		ResMessage: []byte("REVERT opcode executed"),
		Receipt: &core.ResourceReceipt{
			Result: core.Transaction_Result_REVERT,
		},
	})

	if err == nil {
		t.Fatal("expected failed JustLend receipt to return an error")
	}
	for _, want := range []string{"tx-fail", "FAILED", "REVERT", "7500"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error missing %q: %v", want, err)
		}
	}
}

func TestOfficialRentalExpirationUsesJustLendRemainingSeconds(t *testing.T) {
	now := time.Date(2026, 4, 28, 22, 39, 13, 0, time.Local)
	order := officialRentOrder{
		Renter:         "TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk",
		Receiver:       "TNV4d8hvJz7h9XEK9DeRYG4H2YFXChNLAV",
		CanRentSeconds: "227",
	}

	expiresAt, err := officialRentalExpiration(now, order)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := now.Add(227 * time.Second)
	if !expiresAt.Equal(want) {
		t.Fatalf("expected official expiration %s, got %s", want, expiresAt)
	}
}

func TestJustLendRefundToAddressSunReadsReturnInternalTransfer(t *testing.T) {
	platform := mustAddress(t, "TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk")
	receiver := mustAddress(t, "TNV4d8hvJz7h9XEK9DeRYG4H2YFXChNLAV")
	info := &core.TransactionInfo{
		InternalTransactions: []*core.InternalTransaction{
			{
				TransferToAddress: platform,
				CallValueInfo: []*core.InternalTransaction_CallValueInfo{
					{CallValue: 22_441_907},
				},
			},
			{
				TransferToAddress: receiver,
				CallValueInfo: []*core.InternalTransaction_CallValueInfo{
					{CallValue: 14_152_939_649},
				},
			},
			{
				Rejected:          true,
				TransferToAddress: platform,
				CallValueInfo: []*core.InternalTransaction_CallValueInfo{
					{CallValue: 99_000_000},
				},
			},
		},
	}

	refundSun, err := justLendRefundToAddressSun(info, "TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if refundSun != 22_441_907 {
		t.Fatalf("expected refund 22441907 sun, got %d", refundSun)
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

	source, err := os.ReadFile("executor.go")
	if err != nil {
		t.Fatalf("read executor.go: %v", err)
	}
	if strings.Contains(string(source), "if s.cfg.UsesCatFee()") {
		t.Fatal("CatFee renting orders must be synced even after the active provider is switched away from CatFee")
	}
}

func mustAddress(t *testing.T, value string) []byte {
	t.Helper()
	addr, err := address.Base58ToAddress(value)
	if err != nil {
		t.Fatalf("invalid test address %s: %v", value, err)
	}
	return addr
}
