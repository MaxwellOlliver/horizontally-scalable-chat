# syntax=docker/dockerfile:1

# Build context is the REPO ROOT (see docker-compose.yml). Produces a static
# binary in a distroless image.

FROM golang:1.26 AS build
WORKDIR /src
COPY apps/ws-gateway-go/go.mod apps/ws-gateway-go/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/ws-gateway-go/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/ws-gateway-go ./cmd/gateway

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
COPY --from=build /out/ws-gateway-go /ws-gateway-go
EXPOSE 8080
ENTRYPOINT ["/ws-gateway-go"]
