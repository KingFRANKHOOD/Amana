import MediatorPanelClient from "./MediatorPanelClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MediatorPanelClient disputeId={id} />;
}
