import { db } from '../../db/client';
import { usuarios } from '../../db/schema';
import { eq } from 'drizzle-orm';

export async function POST({ request }: any) {
  try {
    const data = await request.json();

    const {
      id,
      cedula,
      primerNombre,
      segundoNombre,
      primerApellido,
      segundoApellido,
      fechaNacimiento,
      departamento,
      ciudad,
      correoElectronico,
      telefono,
    } = data;

    // Validar campos obligatorios
    if (!primerNombre || !primerApellido || !segundoApellido || !cedula) {
      return new Response(
        JSON.stringify({ error: 'Primer nombre, primer apellido, segundo apellido y cédula son obligatorios' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();

    if (id) {
      // Update existing usuario
      const updated = await db
        .update(usuarios)
        .set({
          primerNombre,
          segundoNombre,
          primerApellido,
          segundoApellido,
          fechaNacimiento,
          departamento,
          ciudad,
          correoElectronico,
          telefono,
          updatedAt: now,
        })
        .where(eq(usuarios.id, parseInt(id)))
        .run();

      return new Response(
        JSON.stringify({ success: true, message: 'Usuario actualizado' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      // Create new usuario
      const result = await db
        .insert(usuarios)
        .values({
          cedula,
          primerNombre,
          segundoNombre,
          primerApellido,
          segundoApellido,
          fechaNacimiento,
          departamento,
          ciudad,
          correoElectronico,
          telefono,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return new Response(
        JSON.stringify({ success: true, message: 'Usuario creado', id: result.lastID }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error saving usuario:', error);
    return new Response(
      JSON.stringify({ error: 'Error al guardar usuario' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
