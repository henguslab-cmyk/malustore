import { ProductDetailsByIdPage } from "@/components/stitch/screens";

export default function CatalogProductPage({ params }) {
  return <ProductDetailsByIdPage productId={params.id} />;
}
