import type { Metadata } from "next";
import { JoinCode } from "./JoinCode";

export const metadata: Metadata = { title: "Join with an invite · BolPay" };

export default function JoinIndexPage() {
  return <JoinCode />;
}
