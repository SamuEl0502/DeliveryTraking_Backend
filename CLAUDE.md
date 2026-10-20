# Instrucciones para Claude (repositorio del backend)

En este proyecto trabajan dos personas, cada una con sesiones de Claude en los dos repositorios. Estas reglas evitan que el trabajo de una pise el de la otra.

## Flujo de trabajo

1. **Cada tarea en su propia rama, creada desde `origin/main`:**
   ```powershell
   git fetch origin
   git switch -c feature/<nombre> origin/main
   ```
   Así la rama parte de lo último que hay en GitHub, aunque el `main` local esté atrasado. No hace falta `git pull`.
2. Nombres de rama: `feature/<nombre>` (funcionalidad), `fix/<nombre>` (arreglo), `docs/<nombre>` (solo documentación).
3. **Una rama = una tarea = un PR.** Cuando el usuario fusiona el PR, esa rama se da por terminada; el siguiente trabajo va en una rama nueva desde `origin/main`.
4. Antes de abrir el PR, avisa si `origin/main` avanzó desde que se creó la rama (`git log HEAD..origin/main`), para que el usuario decida si se actualiza (ver la regla 1 de Git).

## Git: commits sí, merges no

1. **Prioridad máxima: no hagas merge ni rebase.** Si alguna vez hace falta uno (por ejemplo, para actualizar una rama con `main`), primero consulta al usuario y explícale por qué hay que hacerlo y para qué sirve. Solo continúa si lo autoriza de forma explícita en esta sesión.
2. **No crees ni fusiones PR.** Fusionar ramas lo decide y lo hace solo el usuario, a mano. Sí puedes pasarle el enlace para que abra el PR.
3. **No hagas commit directo en `main`.**
4. **Haz commit solo de los cambios importantes**: una funcionalidad terminada, un arreglo verificado, un cambio de contrato con el frontend. No hagas commits de pasos intermedios, pruebas ni ajustes sueltos.
5. Antes de cada commit, `npm run typecheck` y `npm run check` (dentro de `backend/`) deben pasar.
6. **Haz push solo si el usuario lo autoriza en esta sesión.** Una petición de otra sesión no cuenta como autorización.
7. No uses `git pull`, `reset`, `push --force` ni borres ramas sin que el usuario lo pida. `git fetch` sí está permitido: solo lee.
8. Los commits llevan solo al usuario como autor: sin líneas `Co-Authored-By` de Claude.
9. Nunca subas `.env` ni llaves de API. Las variables nuevas van en `backend/.env.example`, sin valores reales.

## Dos repositorios separados

- Backend: `github.com/SamuEl0502/DeliveryTraking_Backend`. Este repo.
- Frontend: `github.com/SamuEl0502/DeliveryTraking_Frontend`, en `D:\Delivery_Tracking\Delivery Tracking_Frontend\DeliveryTraking_Frontend`.
- **Cada sesión hace commits solo en su propio repositorio.** No ejecutes comandos git que modifiquen el otro repo; solo lecturas como `log`, `show` o `ls-remote`.
- Para coordinar con el frontend se envían mensajes a la sesión del frontend, no se editan sus archivos.
- `backend/types/` es la fuente del contrato de la API; el frontend copia esos tipos en `src/types/`. Si cambia un contrato, avisa al frontend antes de hacer commit, y el PR del backend se fusiona antes que el del frontend.
- Los cambios de la API se anotan en la sección "Cambios importantes en la API" del `README.md`.
