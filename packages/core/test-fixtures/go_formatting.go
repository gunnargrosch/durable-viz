package main

import "github.com/aws/aws-durable-execution-sdk-go/durable"

type Input struct {
	Note string `json:"note"`
}

func handler(ctx durable.Context, event Input) (string, error) {
	// durable.Wait(ctx, "commented-out", time.Second)
	msg := "durable.Step(ctx, \"in-a-string\")"
	_ = msg
	_ = '}' // a rune literal containing a brace

	/*
		durable.Parallel(ctx, "in-a-block-comment", nil)
	*/

	// Nested generic type arguments (with a closing bracket inside) must not
	// confuse the call scanner.
	result, err := durable.Invoke[map[string]string, any](ctx, "nested-generics", "target-fn:$LATEST", event.Note)
	if err != nil {
		return "", err
	}

	// A brace inside a string literal must not terminate the condition block.
	if event.Note != "}" {
		if _, err := durable.Step(ctx, "guarded", func(sc durable.StepContext) (bool, error) {
			return true, nil
		}); err != nil {
			return "", err
		}
	}

	return result["status"], nil
}

func main() {
	durable.Start(handler)
}
