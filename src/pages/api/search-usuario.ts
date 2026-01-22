import { db } from '../../db/client';
import { usuarios } from '../../db/schema';
import { eq } from 'drizzle-orm';

export async function GET({ url }: any) {
  const cedula = url.searchParams.get('cedula');

  if (!cedula) {
    return new Response(
      JSON.stringify({ error: 'Cédula requerida' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const usuario = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.cedula, cedula))
      .limit(1);

    if (usuario.length > 0) {
      return new Response(
        JSON.stringify({ exists: true, usuario: usuario[0] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ exists: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error searching usuario:', error);
    return new Response(
      JSON.stringify({ error: 'Error en la búsqueda' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
