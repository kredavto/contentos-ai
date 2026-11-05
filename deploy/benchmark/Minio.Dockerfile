# Official MinIO source is checked out and verified by the workflow before build.
FROM golang@sha256:dd80b4158d9c4ca750687719d1a4b79ec9f78f19c4b87b53b73d552ceccfb7a8 AS build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
WORKDIR /source
COPY . .
RUN echo '673f06144e90bc045f0a20050d2874c52e551be5bfbd70dff6e76b66da0db702  go.mod' | sha256sum -c - \
 && echo '86e062349c7abdce0465561bb409d410a95b00b0969ba05d5fb5f2e3550a5cd4  go.sum' | sha256sum -c - \
 && go mod download && go mod verify \
 && echo '673f06144e90bc045f0a20050d2874c52e551be5bfbd70dff6e76b66da0db702  go.mod' | sha256sum -c - \
 && echo '86e062349c7abdce0465561bb409d410a95b00b0969ba05d5fb5f2e3550a5cd4  go.sum' | sha256sum -c - \
 && go build -mod=readonly -trimpath -buildvcs=false -ldflags='-buildid=' -o /out/minio-a . \
 && go build -mod=readonly -trimpath -buildvcs=false -ldflags='-buildid=' -o /out/minio-b . \
 && cmp /out/minio-a /out/minio-b && sha256sum /out/minio-a
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
COPY --from=build /out/minio-a /usr/local/bin/minio
RUN mkdir /data && chown node:node /data
USER node
ENTRYPOINT ["/usr/local/bin/minio"]
