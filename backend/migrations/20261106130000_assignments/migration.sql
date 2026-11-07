-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';
ALTER TYPE "TrackingEventType" ADD VALUE 'ASSIGNED';
ALTER TYPE "TrackingEventType" ADD VALUE 'REASSIGNED';
ALTER TYPE "TrackingEventType" ADD VALUE 'UNASSIGNED';

-- AlterTable
-- Primero admite vacíos para rellenar las filas existentes con la ruta de su vuelo.
-- Un envío sin vuelo hace fallar el SET NOT NULL en vez de quedar sin ruta.
ALTER TABLE "Shipment" ADD COLUMN "originId" TEXT, ADD COLUMN "destinationId" TEXT;

UPDATE "Shipment" s
SET "originId" = f."originId", "destinationId" = f."destinationId"
FROM "Flight" f
WHERE s."flightId" = f."id";

ALTER TABLE "Shipment" ALTER COLUMN "originId" SET NOT NULL, ALTER COLUMN "destinationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
