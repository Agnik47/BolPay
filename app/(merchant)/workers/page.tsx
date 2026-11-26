import type { Metadata } from "next";
import { WorkersView } from "@/app/components/merchant/views/WorkersView";

export const metadata: Metadata = { title: "Workers · BolPay" };

// A worker who opens this page is redirected by the merchant layout before it can render, which Next's dev-time
// "instant navigation" check reports as an error. The page reads the session anyway, so it opts out of that check.
export const instant = false;

export default function Page() {
  return <WorkersView />;
}
