import type { TourDefinition } from "@/components/TourEngine";

/** All available feature tours. Each tour has a unique key and a list of steps.
 *  The `beforeStep` callbacks receive setter functions to navigate the UI. */
export function createVideoGuidesTour(actions: {
  setTab: (tab: string) => void;
  setKbSubTab: (sub: string) => void;
  setAgentInput: (text: string) => void;
  sendAgentMessage: () => void;
}): TourDefinition {
  return {
    key: "video-guides-v1",
    name: "Video Guides",
    steps: [
      {
        title: "Knowledge Base",
        description: "Your Knowledge Base now has a new section. Let's take a look at what's been added.",
        target: '[data-tour="tab-kb"]',
        position: "bottom",
        beforeStep: () => actions.setTab("kb"),
        waitForDom: true,
      },
      {
        title: "Video Guides Tab",
        description: "This new tab contains step-by-step process cards extracted from Loom training videos your team has shared in support tickets.",
        target: '[data-tour="subtab-videos"]',
        position: "bottom",
        beforeStep: () => actions.setKbSubTab("videos"),
        waitForDom: true,
      },
      {
        title: "Process Cards",
        description: "Each card shows a clear title, summary, and numbered steps extracted from a video. Click any card to expand all steps, or click the link icon to watch the original Loom video.",
        target: '[data-tour="video-cards-grid"]',
        position: "bottom",
      },
      {
        title: "Let's try it with the Agent",
        description: "The AI agent now uses video process cards too. Let's ask it a question and see how it references the videos.",
        target: '[data-tour="tab-agent"]',
        position: "bottom",
        beforeStep: () => actions.setTab("agent"),
        waitForDom: true,
      },
      {
        title: "Ask a question",
        description: "We've typed a sample question. Click Next to send it and see how the agent uses video walkthroughs in its response.",
        target: '[data-tour="agent-input"]',
        position: "top",
        beforeStep: () => {
          actions.setAgentInput("How do I create a job posting with assessments?");
        },
        waitForDom: true,
        afterStep: () => {
          actions.sendAgentMessage();
        },
      },
      {
        title: "Video References",
        description: "Look for the video walkthrough references below the response. The agent found relevant Loom videos and included them as step-by-step guides. You're all set!",
        target: '[data-tour="agent-messages"]',
        position: "top",
        waitForDom: true,
        beforeStep: async () => {
          // Wait for the agent response to complete
          await new Promise((r) => setTimeout(r, 8000));
        },
      },
    ],
  };
}

/** Registry of all available tours */
export const TOUR_KEYS = ["video-guides-v1"] as const;
export type TourKey = (typeof TOUR_KEYS)[number];
