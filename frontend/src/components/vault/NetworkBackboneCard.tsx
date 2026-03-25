import Image from 'next/image';
import { BentoCard } from "@/components/ui/BentoCard";
import { NetworkIcon } from "@/components/icons";
import StellarLogo from '../../app/assets/StellarLogo.png';


interface NetworkBackboneCardProps {
  description: string;
}

export function NetworkBackboneCard({ description }: NetworkBackboneCardProps) {
  return (
    <BentoCard
      title="Network Backbone"
      icon={<NetworkIcon className="w-5 h-5" />}
      glowVariant="gold"
      className="h-full"
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <p className="text-sm text-text-secondary max-w-xl leading-relaxed">
          {description}
        </p>
        <div className="flex items-center gap-2 mb-8">
         <Image
            src={StellarLogo}
            alt="stellar logo"
          />
        </div>
      </div>
    </BentoCard>
  );
}
