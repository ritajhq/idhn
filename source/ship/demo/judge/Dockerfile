FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=judge/server main.js main.js

EXPOSE 8081

# Its policies come from the policy builder, published by the console. Its
# audit lines go to stdout as usual, and to the volume the audit server
# follows too (the demo has no log shipper).
CMD ["sh", "-c", "trap 'trap - TERM; kill 0' TERM INT; deno run --allow-net --allow-read --allow-write --allow-env main.js | tee -a /var/log/idhn/judge.jsonl & wait"]
