FROM denoland/deno:alpine-2.9.3

# git for the `git` source; opa, the reference Rego toolchain, to check, test
# and compile policies (its static build runs on alpine's musl).
RUN apk add --no-cache git
COPY --from=openpolicyagent/opa:1.18.2-static /opa /usr/local/bin/opa

WORKDIR /app

COPY --from=policy/builder main.js ./main.js

EXPOSE 8082

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "/app/main.js"]
