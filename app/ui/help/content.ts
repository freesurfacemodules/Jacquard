export interface HelpBlockParagraph {
  type: "paragraph";
  text: string;
}

export interface HelpBlockList {
  type: "list";
  items: string[];
}

export type HelpBlock = HelpBlockParagraph | HelpBlockList;

export interface HelpSection {
  heading: string;
  blocks: HelpBlock[];
}

export interface HelpContent {
  title: string;
  sections: HelpSection[];
}

export const HELP_CONTENT: HelpContent = {
  title: "Welcome to MaxWasm",
  sections: [
    {
      heading: "What Is MaxWasm?",
      blocks: [
        {
          type: "paragraph",
          text: "MaxWasm is a modular playground for designing synthesizers and audio effects. Every patch you build is compiled into a single, highly optimised WebAssembly module so your signal flow runs with zero added buffering."
        },
        {
          type: "paragraph",
          text: "Signals follow the Eurorack 1 volt per octave convention: adding 1.0 to a pitch input raises it by an octave, while subtracting 1.0 lowers it by an octave. Feedback paths run with a minimum of one-sample delay, which keeps tight timing for modulation and resonant effects."
        }
      ]
    },
    {
      heading: "Key Features",
      blocks: [
        {
          type: "list",
          items: [
            "Library of ready-to-use oscillators, filters, utilities, and control sources that interoperate cleanly.",
            "On-demand code generation: click Compile after structural changes to build and run the latest patch.",
            "Subpatch support for grouping reusable building blocks and keeping large projects organised."
          ]
        }
      ]
    },
    {
      heading: "Getting Started",
      blocks: [
        {
          type: "paragraph",
          text: "Add nodes from the Node Browser (left panel) or press the Spacebar while the canvas is focused to open quick search."
        },
        {
          type: "list",
          items: [
            "Drag from an output port to an input port to create a connection. To break a loop, place a DDL Delay or Waveguide Delay between the nodes.",
            "Alt-click any port to remove all connections attached to it. You can also manage connections in the Node Properties panel.",
            "Adjust parameters with the on-screen knobs. Hold Alt while dragging for fine control.",
            "Select multiple nodes by Shift-dragging to box select. Right-click a selection to group it into a Subpatch."
          ]
        },
        {
          type: "paragraph",
          text: "Whenever you add or remove nodes or connections, hit Compile to rebuild the audio engine, then press Run to hear the result."
        }
      ]
    }
  ]
};
