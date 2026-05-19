import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "all": null,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  let companyName: string;
  try {
    companyName = Buffer.from(slug, "base64url").toString("utf8");
  } catch {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }
  if (!companyName) return NextResponse.json({ error: "Empty company name" }, { status: 400 });

  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "30d";
  const days = rangeParam in RANGE_DAYS ? RANGE_DAYS[rangeParam] : 30;
  const sinceTs = days === null ? null : Math.floor(Date.now() / 1000) - days * 86400;

  const repo = new Repository();
  const data = repo.getCustomerTickets(companyName, sinceTs);

  // Build a recommendation string based on the distribution
  const total = data.root_cause_distribution.reduce((sum, r) => sum + r.count, 0);
  const get = (rc: string) => (data.root_cause_distribution.find((r) => r.root_cause === rc)?.count ?? 0) / Math.max(total, 1);
  const howTo = get("how_to");
  const onboarding = get("onboarding_gap");
  const bugs = get("platform_bug");

  let recommendation = "Continue monitoring activity.";
  if (data.tickets.length >= 5 && howTo + onboarding >= 0.6) {
    recommendation = "High share of how-to / onboarding-gap tickets. Schedule a 1:1 onboarding session — this customer likely needs a guided walkthrough rather than ticket-by-ticket support.";
  } else if (bugs >= 0.4) {
    recommendation = "Many platform-bug reports. Loop in engineering and check whether their environment / data flags an unsupported configuration.";
  } else if (data.tickets.length >= 10) {
    recommendation = "High overall ticket volume. Consider a check-in to understand whether they are blocked on a process or workflow.";
  }

  return NextResponse.json({
    company: companyName,
    contacts: data.contacts,
    tickets: data.tickets,
    root_cause_distribution: data.root_cause_distribution,
    recommendation,
  });
}
