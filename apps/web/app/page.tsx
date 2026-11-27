import type { Metadata } from "next";
import LandingPage from "./Components/Landing/LandingPage";

export const metadata: Metadata = {
  title: "CDM-OS | Governed Salesforce Field Cleanup",
  description:
    "The model proposes. CDM-OS decides. Policy-driven, human-approved, audit-signed Salesforce custom field cleanup.",
};

export default function Home() {
  return <LandingPage />;
}
