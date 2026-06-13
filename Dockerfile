# Bucket Fillers — zero-dependency Node stdlib server (bucketfillers.timhufnagel.org).
# State is saved to data.json via write-.tmp-then-atomic-rename, which only works
# when the file and its .tmp sibling live on ONE filesystem. We therefore bind-mount
# the whole app dir at runtime (see docker-compose.yml) and keep this image a thin
# Node runtime — code + data both come from the host mount, so writes never cross a
# filesystem boundary and state survives rebuilds.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
