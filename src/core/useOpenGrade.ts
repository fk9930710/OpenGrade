import { useSyncExternalStore } from "react";
import { openGradeClient } from "./mockClient";

export function useOpenGrade() {
  const state = useSyncExternalStore(
    openGradeClient.subscribe,
    openGradeClient.getSnapshot,
    openGradeClient.getSnapshot,
  );
  return { state, dispatch: openGradeClient.dispatch.bind(openGradeClient) };
}
