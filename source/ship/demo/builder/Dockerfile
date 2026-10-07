FROM denoland/deno:alpine-2.9.7

# opa, the reference Rego toolchain, to check, test and compile policies (its
# static build runs on alpine's musl).
COPY --from=openpolicyagent/opa:1.18.2-static /opa /usr/local/bin/opa

WORKDIR /app

COPY --from=policy/builder main.js main.js
# The demo's base policies: who may use the console.
COPY base /config/base

EXPOSE 8082

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "main.js"]
