# Usuarios, roles y permisos

Rutas web:

```text
/login
/usuarios
/usuarios/roles
```

APIs:

```text
/api/auth/login
/api/auth/logout
/api/auth/me
/api/usuarios
/api/roles
```

## Login obligatorio

La web usa `middleware.js` para exigir sesion.

Si un usuario entra a cualquier URL del portal sin estar logueado, se redirige automaticamente a:

```text
/login
```

Despues de iniciar sesion, la home y la barra superior muestran solo los reportes permitidos para el rol del usuario.

## Navegacion global

La barra superior se renderiza desde `web/components/AppTopbar.js` y aparece en todas las pantallas con sesion activa.

Los reportes se agrupan en desplegables:

- `Operativos`: reporte de horas, novedades laborales y status semanal.
- `Estrategicos`: inversion estrategica, entrega y calidad de servicio.
- `Calidad`: calidad y performance operativa.

La barra tambien incluye un perfil circular. El desplegable del perfil muestra:

- Usuario.
- Rol.
- Accion `Cerrar sesion`.

Al cerrar sesion se elimina la cookie y se redirige a `/`. Como el portal exige login, si no hay sesion activa el middleware vuelve a solicitar autenticacion.

## Usuario inicial

El modelo crea un usuario inicial cuando se ejecuta el ETL o cuando se usa el login por primera vez:

```text
usuario: admin
contrasena temporal: admin123
```

Esta contrasena es temporal y debe cambiarse desde el modulo de usuarios cuando el portal quede operativo.

El usuario `admin` inicial no se puede eliminar desde la web. Ademas, el sistema valida que siempre exista al menos un administrador activo.

## Modelo de permisos

Los permisos se administran por rol.

Flujo esperado:

1. Crear o editar roles en `/usuarios/roles`.
2. Definir que reportes puede ver cada rol.
3. Crear usuarios en `/usuarios`, asignarles un rol y asociarlos a un equipo.

De esta manera no hace falta configurar reportes persona por persona.

## Alcance por equipo

Cada usuario no administrador debe tener un equipo asignado desde `/usuarios`.

Ese equipo se guarda como `app_users.project_id` y se toma de `map_equipo_proyecto.project_id`.

Los reportes operativos se filtran automaticamente por el equipo del usuario:

- `Reporte de horas`: filtra por `project_id`.
- `Novedades laborales`: filtra por `project_id`.
- `Status semanal`: filtra por el nombre del equipo asociado al `project_id`.
- `PGI log`: un usuario no administrador solo puede cargar horas en su equipo.

El administrador puede ver y cargar datos de todos los equipos.

## Tablas

```text
app_users
app_roles
app_role_permissions
app_report_permissions
```

`app_users` guarda:

- `username`
- `password_hash`
- `role`: clave del rol asignado
- `project_id`: equipo/proyecto asignado para limitar reportes operativos
- `enabled`
- `fecha_carga`

`app_roles` guarda:

- `role_key`
- `label`
- `is_admin`
- `enabled`
- `fecha_carga`

`app_role_permissions` guarda:

- `role_key`
- `report_key`
- `can_view`
- `fecha_carga`

`app_report_permissions` queda solo por compatibilidad con el modelo anterior de permisos por usuario.

## Roles iniciales

- `admin`: rol administrador. Tiene todos los reportes habilitados y acceso al modulo de usuarios.
- `viewer`: rol operativo inicial. Por defecto queda habilitado para el reporte de horas.

## Permisos visibles

Al iniciar sesion se cargan en la cookie los reportes permitidos para el rol del usuario y su equipo asignado.

La home usa esos permisos para mostrar solo los accesos habilitados.

Las rutas `/reportes/...` tambien verifican la sesion y redirigen a la home si el usuario no tiene el reporte asignado.

La ruta `/usuarios` y la ruta `/usuarios/roles` quedan reservadas para el rol `admin`.
