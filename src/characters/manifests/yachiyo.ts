import type { CharacterManifest } from "../types/CharacterManifest";

export const yachiyoManifest: CharacterManifest = {
  id: "yachiyo",
  displayName: "八千代辉夜姬",
  engine: "live2d-cubism",
  modelPath: "/assets/character/yachiyo.model3.json",
  directorPath: "/assets/character/character_extensions/director/yachiyo_director.json",
  defaultState: "idle_neutral",
  tags: ["female", "live2d", "default"],
  stateGroups: [
    {
      label: "Happy",
      stateIds: ["happy", "soft_smile", "excited", "celebrate", "closed_eye_smile", "proud"],
    },
    {
      label: "Neutral / Cognitive",
      stateIds: ["idle_neutral", "curious", "thinking", "focused"],
    },
    {
      label: "Negative",
      stateIds: ["angry", "annoyed", "disgusted"],
    },
    {
      label: "Emotional",
      stateIds: ["sad", "crying", "tear_drop", "embarrassed", "surprised"],
    },
    {
      label: "Sleep",
      stateIds: ["sleepy", "sleep", "wake_up"],
    },
    {
      label: "Events",
      stateIds: [
        "notification",
        "ai_waiting",
        "ai_completed",
        "typing",
        "dragged",
        "thrown",
        "low_battery",
        "friend_online",
      ],
    },
  ],
};
