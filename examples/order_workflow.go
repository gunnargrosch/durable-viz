// Command order-workflow demonstrates a durable order processing workflow
// built with the AWS Durable Execution SDK for Go.
//
// It exercises the core primitives naturally:
//   - Step for validation, with the result checkpointed for replay
//   - Parallel for concurrent shipment preparation (label + tracking)
//   - Wait for a cooling-off period between preparation and charging
//   - WaitForCallback for an optional manager approval
//   - An if statement wrapping a durable call for the conditional approval
package main

import (
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-durable-execution-sdk-go/durable"
)

// OrderEvent is the workflow input.
type OrderEvent struct {
	OrderID         string   `json:"orderId"`
	CustomerID      string   `json:"customerId"`
	Amount          float64  `json:"amount"`
	Items           []string `json:"items"`
	RequireApproval bool     `json:"requireApproval"`
}

// OrderResult is the workflow output.
type OrderResult struct {
	Status   string `json:"status"`
	Label    string `json:"label"`
	Tracking string `json:"tracking"`
}

func handler(ctx durable.Context, event OrderEvent) (OrderResult, error) {
	// Validate the order before doing any work.
	if _, err := durable.Step(ctx, "validate-order", func(sc durable.StepContext) (bool, error) {
		if event.Amount <= 0 {
			return false, errors.New("order amount must be positive")
		}
		return true, nil
	}); err != nil {
		return OrderResult{}, err
	}

	// Prepare the shipment in parallel: the label and tracking number are
	// generated concurrently and looked up by branch name afterwards.
	shipment, err := durable.Parallel(ctx, "prepare-shipment", []durable.Branch[string]{
		{
			Name: "generate-label",
			Func: func(branch durable.Context) (string, error) {
				return durable.Step(branch, "label", func(sc durable.StepContext) (string, error) {
					return fmt.Sprintf("https://labels.example.com/%s", event.OrderID), nil
				})
			},
		},
		{
			Name: "generate-tracking",
			Func: func(branch durable.Context) (string, error) {
				return durable.Step(branch, "tracking", func(sc durable.StepContext) (string, error) {
					return fmt.Sprintf("TRK-%s", event.OrderID), nil
				})
			},
		},
	})
	if err != nil {
		return OrderResult{}, fmt.Errorf("prepare shipment: %w", err)
	}
	label, _ := shipment.Result("generate-label")
	tracking, _ := shipment.Result("generate-tracking")

	// Cooling-off period before charging the customer.
	if err := durable.Wait(ctx, "cooling-off", 5*time.Second); err != nil {
		return OrderResult{}, fmt.Errorf("wait interrupted: %w", err)
	}

	// Pause for a human approval only when the order requires it.
	if event.RequireApproval {
		if _, err := durable.WaitForCallback[string](ctx, "manager-approval", func(sc durable.StepContext, callbackID string) error {
			// TODO: notify the approver with callbackID
			return nil
		}, durable.WithCallbackTimeout(24*time.Hour)); err != nil {
			return OrderResult{}, fmt.Errorf("approval failed: %w", err)
		}
	}

	return OrderResult{
		Status:   "FULFILLED",
		Label:    label,
		Tracking: tracking,
	}, nil
}

func main() {
	durable.Start(handler)
}
