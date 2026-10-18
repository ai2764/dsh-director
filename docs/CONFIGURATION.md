# Connections and changing ports

This is the configuration guide referenced by the demo's installation chapter.
The example assumes Harness, ComfyUI and llama-swap are already installed. The
plugin does not start these services or change their listening ports.

## Which setting do I change?

| Connection | Example in the demo | Where to change it |
| --- | --- | --- |
| Browser → Harness Web | `http://127.0.0.1:3080` | Harness launch flag `--port` |
| Harness → model API | `http://127.0.0.1:11435/v1` | Harness **Settings → Models**, provider API address |
| Director → ComfyUI | `http://127.0.0.1:8188` | Director plugin `config.comfyBaseUrl` |
| Director → llama-swap control API | `http://127.0.0.1:11435` | Director plugin `config.llamaSwapBaseUrl` |

`3080` is an example Harness port, not a required default. `8188` and `11435`
are this plugin's default service ports. The model API includes `/v1` for the
OpenAI-compatible server in this example; both plugin service values are bare
HTTP(S) origins, with no path, query, fragment or embedded credentials.

## Change the Harness Web port

Stop Harness when no active turn or managed generation needs preserving, then
launch it on the new port from your project directory:

```sh
dsh web --no-open --port 8080
```

In Windows PowerShell:

```powershell
dsh.cmd web --no-open --port 8080
```

Open the complete launch URL printed by Harness, including its initial access
token when present. The plugin's media and GPU-status endpoints use the same
Harness server automatically. No Director port setting needs changing for this.
Keep any existing `--host` and `--trusted-host` options appropriate to your setup;
changing the port does not itself enable LAN access. Keep authentication enabled.

## Change ComfyUI or llama-swap ports

First change the service's own launch/configuration so that it actually listens
at the new address. Then edit the active Harness **Web profile patch**, which is
separate from this repository's bundled `cordis.patch.yml`.

The profile patch is:

- With `DSH_HOME` set: `<DSH_HOME>/profiles/web/cordis.patch.yml`.
- Default Windows location: `C:/Users/<you>/.dsh/profiles/web/cordis.patch.yml`.
- Default Linux/macOS location: `~/.dsh/profiles/web/cordis.patch.yml`.
- For a custom profile, replace `web` with its actual profile name.

Back up that file. Add this override to its existing YAML list, or update the
existing `dsh-director` override. Keep all other entries:

```yaml
- id: dsh-director
  config:
    comfyBaseUrl: http://127.0.0.1:8190
    llamaSwapBaseUrl: http://127.0.0.1:11535
```

This example uses ComfyUI on `8190` and llama-swap on `11535`. Replace both with
your real addresses. The installed bundle already inserts the plugin, so this
override does not need another `insert` or `name` field. Do not edit the installed
package's files: reinstalling would replace them. If an existing patch already
inserts `dsh-director`, change its `config` or add the override after that insertion.

Restart Harness after saving, when its jobs are idle, then refresh the browser.
An enabled profile reload service may apply the change sooner. A home-level patch
or `--patch` overlay can override this profile; check those if old values persist.

Changing the llama-swap port also requires changing the model provider's API
address in **Settings → Models** to `http://127.0.0.1:11535/v1`. The plugin control
URL remains `http://127.0.0.1:11535`, without `/v1`.

## Configure model and image input

In Harness **Settings → Models**, add or edit your model provider:

1. Choose the API protocol supported by your model server and enter its API address.
2. Supply the credential the server requires, if any; keep real credentials in
   your private Harness configuration, never this repository.
3. Add the exact model ID advertised by that server and choose sensible context
   and output limits for the loaded model.
4. In the model options, select **Text** and **Image**, save, then select that
   model in your conversation.

The **Image** option tells Harness to send images. It does not turn a text-only
model into a vision model or configure the server's vision projector. Follow
your backend's own vision setup instructions. llama-swap, Ollama and LM Studio
do not share identical configuration or model IDs.

Other compatible servers can provide the conversation model, but Director's
managed unload/handoff currently calls llama-swap's control API. Pointing
`llamaSwapBaseUrl` at an Ollama or LM Studio server does not add that API. The
managed handoff therefore requires a separately reachable, applicable llama-swap
service; general model-provider compatibility does not imply GPU coordination
with every backend.

## Another machine, WSL or a container

Use addresses reachable **from the process running Harness**. `127.0.0.1` always
means that process's own network environment. For example, if Harness runs in
WSL while ComfyUI runs on Windows, use the Windows service address reachable
from WSL, unless your existing localhost forwarding already provides it.

Update the provider API address and plugin service origins independently. The
browser's address is not necessarily the host address that Harness should use
for ComfyUI. Keep private services on a trusted network with appropriate binding,
firewall and authentication settings.

## Check connections without starting a generation

Run these read-only checks on the machine/environment where Harness runs. Replace
the example ports with yours. On Windows use `curl.exe` to avoid shell aliases;
on Linux/macOS use `curl`.

```sh
curl --fail http://127.0.0.1:8190/system_stats
curl --fail http://127.0.0.1:11535/v1/models
curl --fail http://127.0.0.1:11535/running
```

The first checks ComfyUI, the second the example model API, and the third
llama-swap's control endpoint. A server requiring credentials needs its own
authenticated check. The plugin's current service-origin settings do not accept
embedded credentials or arbitrary API paths.

If chat works but Director cannot stage references or submit, check
`comfyBaseUrl`. If chat works but unloading fails, check `llamaSwapBaseUrl` and
the actual llama-swap service. If images upload but the model cannot see them,
check both Harness's **Image** input option and the server/model's vision support.
No ComfyUI workflow, node or model weight is supplied by the plugin.
