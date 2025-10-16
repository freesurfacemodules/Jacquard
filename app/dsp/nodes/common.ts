import { PortDescriptor } from "@graph/types";

export const audioPort = (id: string, name: string): PortDescriptor => ({
  id,
  name,
  type: "audio"
});
