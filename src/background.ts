import { ArIO, Gateway } from "@ar.io/sdk/web";

export type OnlineGateway = Gateway & {
  online?: boolean;
};

const ario = ArIO.init();

console.log(ario);
