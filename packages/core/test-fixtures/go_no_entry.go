package main

// Not a durable function: no durable.Start() or durable.Wrap() entry point.

func handler(value string) string {
	return value
}
