// Command order-parallel-mixed demonstrates ParallelMixed, the GA Go SDK
// primitive for fanning out named branches with different result types.
//
// Run: npx durable-viz examples/order_parallel_mixed.go --open
package main

import (
	"time"

	"github.com/aws/aws-durable-execution-sdk-go/durable"
)

type OrderEvent struct {
	OrderID string `json:"orderId"`
}

func handler(ctx durable.Context, event OrderEvent) (any, error) {
	// ParallelMixed takes []durable.AnyBranch. NewTypedBranch keeps each
	// branch's own result type, and TypedBranch.Result reads it back.
	profile := durable.NewTypedBranch("load-profile", func(branch durable.Context) (map[string]string, error) {
		return durable.Step(branch, "load-profile", func(sc durable.StepContext) (map[string]string, error) {
			return map[string]string{"customerId": "c-1"}, nil
		}, durable.WithStepSubType("ProfileLookup"))
	})

	orders := durable.NewTypedBranch("count-orders", func(branch durable.Context) (int, error) {
		return durable.Step(branch, "count-orders", func(sc durable.StepContext) (int, error) {
			return 3, nil
		})
	})

	reservation := durable.NewTypedBranch("reserve-inventory", func(branch durable.Context) (string, error) {
		if err := durable.Wait(branch, "inventory-delay", 2*time.Second); err != nil {
			return "", err
		}
		return durable.Step(branch, "reserve-inventory", func(sc durable.StepContext) (string, error) {
			return "reserved", nil
		})
	})

	result, err := durable.ParallelMixed(ctx, "load-order", []durable.AnyBranch{
		profile, orders, reservation,
	}, durable.WithMaxConcurrency(3))
	if err != nil {
		return nil, err
	}

	customer, err := profile.Result(result)
	if err != nil {
		return nil, err
	}
	count, err := orders.Result(result)
	if err != nil {
		return nil, err
	}
	inventory, err := reservation.Result(result)
	if err != nil {
		return nil, err
	}

	// A callback can carry a custom subtype too.
	if _, err := durable.WaitForCallback[string](ctx, "manager-approval", func(sc durable.StepContext, callbackID string) error {
		return nil
	}, durable.WithCallbackSubType("ManagerApproval")); err != nil {
		return nil, err
	}

	return map[string]any{
		"customer":  customer["customerId"],
		"orders":    count,
		"inventory": inventory,
	}, nil
}

func main() {
	durable.Start(handler)
}
