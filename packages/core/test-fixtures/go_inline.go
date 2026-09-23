package main

import "github.com/aws/aws-durable-execution-sdk-go/durable"

func main() {
	durable.Wrap(func(ctx durable.Context, event any) (any, error) {
		_ = event
		return durable.Step(ctx, "inline-step", func(sc durable.StepContext) (any, error) {
			return nil, nil
		})
	})
}
