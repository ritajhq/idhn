FROM denoland/deno:alpine-2.9.3

WORKDIR /opt/guard

COPY --from=artifacts guard/embedded/main.js ./main.js
COPY start-guard.sh /opt/guard/start-guard.sh

RUN chmod +x /opt/guard/start-guard.sh

# No CMD/ENTRYPOINT: a consuming Dockerfile does `FROM guard/base`, adds its
# own service, and calls /opt/guard/start-guard.sh from its own CMD to
# launch guard in the background before execing its service in the
# foreground, e.g.:
#
#   CMD ["sh", "-c", "/opt/guard/start-guard.sh && exec my-service"]
