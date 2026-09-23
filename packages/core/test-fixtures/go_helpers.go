package main

import "github.com/aws/aws-durable-execution-sdk-go/durable"

type Input struct {
	Value string `json:"value"`
}

func handler(ctx durable.Context, event Input) (string, error) {
	stepName := "dynamic-step"

	if err := processOrder(ctx, event); err != nil {
		return "", err
	}

	return durable.Step(ctx, stepName, func(sc durable.StepContext) (string, error) {
		return "done", nil
	})
}

func processOrder(ctx durable.Context, event Input) error {
	if _, err := durable.Step(ctx, "validate", func(sc durable.StepContext) (bool, error) {
		return event.Value != "", nil
	}); err != nil {
		return err
	}
	return nil
}

func main() {
	durable.Start(handler)
}
