import PublicNav from "@/app/components/PublicNav";
import GetStartedClient from "./GetStartedClient";

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function GetStartedPage({ searchParams }: Props) {
  const params = await searchParams;
  const planParam = params.plan;
  const defaultPlanId = (Array.isArray(planParam) ? planParam[0] : planParam) ?? "growth";

  return (
    <>
      <PublicNav />
      <GetStartedClient defaultPlanId={defaultPlanId} />
    </>
  );
}
