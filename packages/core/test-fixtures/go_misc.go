package main

import "github.com/aws/aws-durable-execution-sdk-go/durable"

func handler(ctx durable.Context, event any) (any, error) {
	_ = event

	cb, err := durable.CreateCallback[string](ctx, "external-callback")
	if err != nil {
		return nil, err
	}
	_ = cb

	child := durable.Go(ctx, "background", func(child durable.Context) (string, error) {
		return durable.Step(child, "background-step", func(sc durable.StepContext) (string, error) {
			return "ok", nil
		})
	})
	_ = child

	if err := durable.Join(ctx, "join", []durable.Awaitable{child}); err != nil {
		return nil, err
	}

	winner, _, err := durable.Select(ctx, "pick", []durable.Branch[string]{
		{Name: "primary", Func: func(ctx durable.Context) (string, error) { return "p", nil }},
		{Name: "secondary", Func: func(ctx durable.Context) (string, error) { return "s", nil }},
	})
	if err != nil {
		return nil, err
	}
	_ = winner

	return nil, nil
}

func main() {
	durable.Start(handler)
}
