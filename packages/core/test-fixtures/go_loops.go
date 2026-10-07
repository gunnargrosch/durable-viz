package main

import (
	"time"

	"github.com/aws/aws-durable-execution-sdk-go/durable"
)

type Input struct {
	Orders []string `json:"orders"`
}

func handler(ctx durable.Context, event Input) (string, error) {
	durable.Step(ctx, "start", func(sc durable.StepContext) (bool, error) {
		return true, nil
	})

	for _, order := range event.Orders {
		durable.Step(ctx, "validate", func(sc durable.StepContext) (string, error) {
			return order, nil
		})
		if order == "vip" {
			durable.Step(ctx, "vip-perk", func(sc durable.StepContext) (string, error) {
				return order, nil
			})
		}
		durable.Step(ctx, "charge", func(sc durable.StepContext) (string, error) {
			return order, nil
		})
	}

	for attempt := 0; attempt < 3; attempt++ {
		durable.Wait(ctx, "backoff", 5*time.Second)
	}

	for range 2 {
		durable.Step(ctx, "twice", func(sc durable.StepContext) (string, error) {
			return "x", nil
		})
	}

	for _, region := range []string{"us", "eu"} {
		durable.Step(ctx, "per-region", func(sc durable.StepContext) (string, error) {
			return region, nil
		})
	}

	for {
		durable.Step(ctx, "poll", func(sc durable.StepContext) (bool, error) {
			return true, nil
		})
		break
	}

	for _, ignored := range event.Orders {
		_ = ignored
	}

	return durable.Step(ctx, "finish", func(sc durable.StepContext) (string, error) {
		return "done", nil
	})
}

func main() {
	durable.Start(handler)
}
