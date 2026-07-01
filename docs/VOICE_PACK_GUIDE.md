# Custom response voice pack

This is the lightest way to use a custom voice without loading XTTS at runtime.
Generate each fixed sentence once using a voice-cloning service or model you have permission to use, export the audio, and copy it to:

`public/assets/voice-packs/custom/`

Then map the response ID to its filename in `manifest.json`.

| Response ID | Current built-in sentence |
|---|---|
| `morning` | Good morning, Boss. I am awake and ready for you. |
| `afternoon` | Good afternoon, Boss. Tell me what we are handling next. |
| `evening` | Good evening, Boss. I am right here. |
| `hello` | Hello, Boss. I am listening. |
| `creator` | Pratham created this Desktop Buddy project. |
| `identity` | I am your Desktop Buddy. You may give me any name you like, Boss. |
| `capabilities` | I can react to your desktop activity, listen, speak, animate, follow your cursor, and prepare work for connected agents. More tools will arrive in later phases. |
| `thanks` | You are welcome, Boss. I am right here when you need me. |
| `love` | Aww. I love having you here too, Boss. |
| `sleep` | All right, Boss. I will quiet down for now. |
| `wake` | I am back online, Boss. |
| `desktop-action` | I understood the desktop action you want. I will execute actions like opening sites, searching, and playing music once the desktop-tool agent is connected. |
| `repeat` | Of course. Ask me the sentence you want repeated. |
| `continuous-morning` | Good morning, Boss. Continuous conversation is ready. |
| `continuous-afternoon` | Good afternoon, Boss. Continuous conversation is ready. |
| `continuous-evening` | Good evening, Boss. I am ready to listen. |
| `continuous-night` | You are still awake, Boss? I am ready to listen. |

The live time/date and arbitrary future AI responses are dynamic, so the app falls back to gTTS when no exact clip exists.

## Install a folder automatically

Name each audio file after its response ID, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-voice-pack.ps1 `
  -SourceFolder "E:\MyGeneratedBuddyVoice" `
  -PackName "My Custom Voice" `
  -Language "en-IN"
```

The script copies the clips and builds `manifest.json` automatically.
