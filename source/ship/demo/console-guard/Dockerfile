FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=guard/standalone main.js main.js
COPY manifest.yaml /config/

EXPOSE 8080

# Its audit lines go to stdout as usual, and to the volume the audit server
# follows too (the demo has no log shipper).
CMD ["sh", "-c", "trap 'trap - TERM; kill 0' TERM INT; deno run --allow-net --allow-read --allow-env main.js | tee -a /var/log/idhn/console-guard.jsonl & wait"]
