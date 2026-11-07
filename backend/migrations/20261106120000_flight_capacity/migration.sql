-- AlterTable
-- El DEFAULT temporal permite migrar bases que ya tienen vuelos; después se quita para que
-- todo vuelo nuevo tenga que declarar su capacidad. Los vuelos existentes quedan en 0 hasta correr el seed.
ALTER TABLE "Flight" ADD COLUMN "capacityKg" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "Flight" ALTER COLUMN "capacityKg" DROP DEFAULT;
