// Command order-workflow-config demonstrates the config-level features of the
// AWS Durable Execution SDK for Go alongside the concurrency combinators.
//
// It exercises:
//   - Step with a retry strategy and AtMostOncePerRetry semantics
//   - Invoke with tenant isolation
//   - Map with bounded concurrency and a tolerated-failure completion policy
//   - RunInChildContext with a virtual (flat) child
//   - Retry for grouping a flaky section of work
//   - WaitForCondition for polling an external state
//   - All, Any, Race, and AllSettled over async operation futures
package main

import (
	"fmt"
	"time"

	"github.com/aws/aws-durable-execution-sdk-go/durable"
	"github.com/aws/aws-sdk-go-v2/aws"
)

// OrderEvent is the workflow input.
type OrderEvent struct {
	OrderID    string   `json:"orderId"`
	CustomerID string   `json:"customerId"`
	Items      []string `json:"items"`
}

func handler(ctx durable.Context, event OrderEvent) (any, error) {
	// Charge payment with retry and at-most-once semantics.
	if _, err := durable.Step(ctx, "charge-payment", func(sc durable.StepContext) (string, error) {
		return "payment-1", nil
	}, durable.WithRetry(durable.ExponentialBackoff()), durable.WithSemantics(durable.AtMostOncePerRetry)); err != nil {
		return nil, err
	}

	// Notify the customer by invoking another durable function in a tenant.
	if _, err := durable.Invoke[string](ctx, "notify-customer", "notify-fn:$LATEST", event.OrderID, durable.WithTenantID("tenant-001")); err != nil {
		return nil, err
	}

	// Reserve inventory for each item with bounded concurrency, tolerating a
	// small number of failures.
	if _, err := durable.Map(ctx, "reserve-inventory", event.Items, func(ctx durable.Context, item string, index int) (string, error) {
		return durable.Step(ctx, "reserve-item", func(sc durable.StepContext) (string, error) {
			return fmt.Sprintf("reserved-%s", item), nil
		})
	}, durable.WithMaxConcurrency(4), durable.WithCompletion(durable.CompletionConfig{
		MinSuccessful:         1,
		ToleratedFailureCount: aws.Int(2),
	})); err != nil {
		return nil, err
	}

	// Group the ledger work in a virtual child context.
	if _, err := durable.RunInChildContext(ctx, "settlement", func(child durable.Context) (string, error) {
		return durable.Step(child, "close-ledger", func(sc durable.StepContext) (string, error) {
			return "closed", nil
		})
	}, durable.WithChildVirtual()); err != nil {
		return nil, err
	}

	// Retry a flaky synchronization group with linear backoff.
	if _, err := durable.Retry(ctx, "flaky-sync", func(retryCtx durable.Context, attempt int) (string, error) {
		return "synced", nil
	}, durable.MustLinearBackoff(durable.LinearRetryConfig{
		MaxAttempts:  5,
		InitialDelay: time.Second,
		Increment:    time.Second,
		MaxDelay:     10 * time.Second,
	})); err != nil {
		return nil, err
	}

	// Poll until the shipment is marked ready.
	if _, err := durable.WaitForCondition(ctx, "await-shipment", func(sc durable.StepContext, state int) (int, error) {
		return state + 1, nil
	}, durable.ConditionConfig[int]{}); err != nil {
		return nil, err
	}

	// Kick off async operations and await them with the combinators.
	charge := durable.StepAsync(ctx, "charge-async", func(sc durable.StepContext) (string, error) {
		return "charge-1", nil
	})
	notify := durable.InvokeAsync[string](ctx, "notify-async", "notify-fn:$LATEST", event.OrderID)

	if _, err := durable.All(ctx, "await-all", []*durable.Future[string]{charge, notify}); err != nil {
		return nil, err
	}
	if _, err := durable.Any(ctx, "await-any", []*durable.Future[string]{charge, notify}); err != nil {
		return nil, err
	}
	if _, err := durable.Race(ctx, "await-race", []*durable.Future[string]{charge, notify}); err != nil {
		return nil, err
	}
	if _, err := durable.AllSettled(ctx, "await-settled", []*durable.Future[string]{charge, notify}); err != nil {
		return nil, err
	}

	return map[string]any{"status": "completed"}, nil
}

func main() {
	durable.Start(handler)
}
