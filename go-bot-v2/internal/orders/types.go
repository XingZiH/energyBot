package orders

import "time"

type Status string

const (
	StatusPendingPayment Status = "pending_payment"
	StatusPaid           Status = "paid"
	StatusEnergyRented   Status = "energy_rented"
	StatusExpired        Status = "expired"
	StatusReclaimed      Status = "reclaimed"
	StatusFailed         Status = "failed"
)

type Order struct {
	ID                    string
	UserID                string
	Status                Status
	ExpectedAmountSun     int64
	PaymentAddress        string
	PaymentTxID           string
	EnergyReceiverAddress string
	JustLendTxID          string
	PaymentExpiresAt      time.Time
	EnergyRentalExpiresAt time.Time
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

type Repository interface {
	FindPendingPayments(now time.Time) ([]Order, error)
	MarkPaid(orderID string, txID string, paidAt time.Time) error
	FindExpiredRentals(now time.Time) ([]Order, error)
	MarkReclaimed(orderID string, txID string, reclaimedAt time.Time) error
	MarkFailed(orderID string, reason string) error
}
