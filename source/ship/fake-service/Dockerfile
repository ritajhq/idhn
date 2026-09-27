FROM denoland/deno:alpine-2.9.3

WORKDIR /app

COPY --from=artifacts fake-service/main.js ./main.js

CMD ["deno", "run", "--allow-net", "--allow-env", "/app/main.js"]

EXPOSE 9100
