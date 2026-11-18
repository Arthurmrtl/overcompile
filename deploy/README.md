# Deploying at home

The game is a static site packaged as a small nginx image. The pipeline:

```
push on main ──► GitHub Actions: build + publish ghcr.io/<owner>/overcompile:latest
                                                  │
home server (Docker) ◄── Watchtower pulls the new image every 5 min
        │
Nginx Proxy Manager ──► https://overcompile.<your domain>
```

## 1. First publication

1. Push the repository to GitHub, on `main`.
2. Wait for the **CI** workflow to finish (Actions tab). It publishes the image to
   `ghcr.io/<owner>/overcompile`.
3. The package is private by default. Either make it public (repository → Packages →
   overcompile → Package settings → Change visibility), or log the server in once:
   `echo <PAT with read:packages> | docker login ghcr.io -u <owner> --password-stdin`.

## 2. On the server (a Proxmox VM or LXC with Docker)

```bash
mkdir -p /opt/overcompile && cd /opt/overcompile
# copy docker-compose.yml here
docker compose up -d
curl http://localhost:8080/healthz   # → ok
```

Watchtower is optional: remove its service if you prefer to update by hand
(`docker compose pull && docker compose up -d`).

## 3. Nginx Proxy Manager

Add a proxy host:

- Domain: `overcompile.<your domain>`
- Forward: `http` · IP of the Docker host · port `8080`
- SSL: request a Let's Encrypt certificate, force SSL

## Notes

- **Saves live in each player's browser**, per address. Moving the game to a new address starts
  everyone from zero: use ⚙ → Export / Import to carry a save over.
- **GPL-3.0**: serving the game to other people means its source must be available to them.
  A public GitHub repository and the link in the game's footer cover that.
