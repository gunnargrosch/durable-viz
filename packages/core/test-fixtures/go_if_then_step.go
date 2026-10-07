package main

import "github.com/aws/aws-durable-execution-sdk-go/durable"

func handler(ctx durable.Context, event string) (string, error) {
	if event == "vip" {
		durable.Step(ctx, "vip-perk", func(sc durable.StepContext) (string, error) {
			return event, nil
		})
	}
	durable.Step(ctx, "charge", func(sc durable.StepContext) (string, error) {
		return event, nil
	})
	return "", nil
}

func main() {
	durable.Start(handler)
}
