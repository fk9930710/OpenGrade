import type {
  Command,
  CommandSource,
  MaskReference,
  OperationType,
} from "../types";

export type AgentCommand =
  | Command
  | {
      type: "media.openPath";
      path: string;
      name?: string;
      palette?: string;
      source?: CommandSource;
    };

export type CommandBatch = {
  id: string;
  title: string;
  description: string;
  source: CommandSource;
  commands: AgentCommand[];
};

type DispatchCommand = (command: Command) => Promise<void>;

type AddOperationOptions = {
  operationId?: string;
  masks?: MaskReference[];
  lutPath?: string;
};

function addOperation(
  operationType: OperationType,
  values: Record<string, number>,
  commandText: string,
  options: AddOperationOptions = {},
): Command {
  return {
    type: "operation.add",
    operationId: options.operationId,
    operationType,
    values,
    lutPath: options.lutPath,
    masks: options.masks,
    source: "agent",
    commandText,
  };
}

function curveValues(p1Y: number, p3Y: number, blend = 100): Record<string, number> {
  return {
    Point0X: 0,
    Point0Y: 0,
    Point1X: 0.25,
    Point1Y: p1Y,
    Point2X: 0.5,
    Point2Y: 0.5,
    Point3X: 0.75,
    Point3Y: p3Y,
    Point4X: 1,
    Point4Y: 1,
    Blend: blend,
  };
}

export const agentGradePresets: CommandBatch[] = [
  {
    id: "warm-cinematic",
    title: "Warm cinematic",
    description: "Warmer highlights, gentle contrast, richer color.",
    source: "agent",
    commands: [
      addOperation("Exposure", { Exposure: 0.15, Blend: 100 }, "add Exposure +0.15"),
      addOperation("BasicAdjustments", { Contrast: 12, Highlights: -18, Shadows: 8, Whites: 6, Blacks: -8, Blend: 100 }, "add BasicAdjustments warm contrast"),
      addOperation("WhiteBalance", { Temperature: 420, Tint: 4, Blend: 100 }, "add WhiteBalance temp +420K tint +4"),
      addOperation("Curve", curveValues(0.2, 0.84), "add Curve soft S-curve"),
      addOperation("HSV", { Hue: 0, Saturation: 10, Value: 0, Blend: 100 }, "add HSV saturation +10"),
    ],
  },
  {
    id: "cool-clean",
    title: "Cool clean",
    description: "Cooler white balance with restrained contrast.",
    source: "agent",
    commands: [
      addOperation("WhiteBalance", { Temperature: -520, Tint: -3, Blend: 100 }, "add WhiteBalance temp -520K tint -3"),
      addOperation("Exposure", { Exposure: 0.08, Blend: 100 }, "add Exposure +0.08"),
      addOperation("BasicAdjustments", { Contrast: 6, Highlights: -10, Shadows: 6, Whites: 2, Blacks: -3, Blend: 100 }, "add BasicAdjustments restrained contrast"),
      addOperation("Curve", curveValues(0.23, 0.8), "add Curve clean mild S-curve"),
      addOperation("HSV", { Hue: 0, Saturation: -4, Value: 0, Blend: 100 }, "add HSV saturation -4"),
    ],
  },
  {
    id: "high-contrast-bw",
    title: "High contrast B&W",
    description: "Monochrome look with deeper shadows and bright highlights.",
    source: "agent",
    commands: [
      addOperation("HSV", { Hue: 0, Saturation: -100, Value: 0, Blend: 100 }, "add HSV saturation -100"),
      addOperation("Exposure", { Exposure: 0.2, Blend: 100 }, "add Exposure +0.20"),
      addOperation("BasicAdjustments", { Contrast: 24, Highlights: 8, Shadows: -12, Whites: 10, Blacks: -18, Blend: 100 }, "add BasicAdjustments high contrast"),
      addOperation("Curve", curveValues(0.16, 0.88), "add Curve strong S-curve"),
    ],
  },
];

export async function applyCommandBatch(
  dispatch: DispatchCommand,
  batch: CommandBatch,
): Promise<void> {
  for (const command of batch.commands) {
    if (command.type === "media.openPath") continue;
    await dispatch({
      ...command,
      source: "source" in command && command.source ? command.source : batch.source,
    } as Command);
  }
  await dispatch({
    type: "assistant.apply",
    prompt: `Applied command batch: ${batch.title}`,
    source: batch.source,
  });
}
