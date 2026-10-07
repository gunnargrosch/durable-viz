// Example durable function: batch order processing with loops.
//
// Run: npx durable-viz examples/order_batch_loop.go --open
package main

import (
	"time"

	"github.com/aws/aws-durable-execution-sdk-go/durable"
)

type Batch struct {
	Orders []Order `json:"orders"`
}

func handler(ctx durable.Context, batch Batch) (string, error) {
	durable.Step(ctx, "load-batch", func(sc durable.StepContext) (int, error) {
		return len(batch.Orders), nil
	})

	// Runs once per order. Each iteration is a separate set of checkpointed steps.
	for _, order := range batch.Orders {
		durable.Step(ctx, "validate-order", func(sc durable.StepContext) (bool, error) {
			return validate(order), nil
		})

		if order.Total > 10000 {
			durable.WaitForCallback(ctx, "manager-approval", func(cc durable.CallbackContext, callbackID string) error {
				return notifyManager(callbackID, order)
			})
		}

		durable.Step(ctx, "charge-order", func(sc durable.StepContext) (bool, error) {
			return charge(order), nil
		})
	}

	// Poll up to three times, waiting between attempts.
	for attempt := 0; attempt < 3; attempt++ {
		durable.Wait(ctx, "wait-for-settlement", 30*time.Second)
		durable.Step(ctx, "check-settlement", func(sc durable.StepContext) (bool, error) {
			return settled(batch), nil
		})
	}

	return durable.Step(ctx, "send-summary", func(sc durable.StepContext) (string, error) {
		return "completed", nil
	})
}

func main() {
	durable.Start(handler)
}
