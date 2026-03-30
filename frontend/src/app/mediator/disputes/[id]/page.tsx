import MediatorPanelClient from "./MediatorPanelClient";


export default function Page({ params }: { params: { id: string } }) {
  const { id } = params;
  return <MediatorPanelClient disputeId={id} />;
}
