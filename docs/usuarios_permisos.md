# Usuarios y permisos

Ruta web:

```text
/usuarios
```

Login:

```text
/login
```

APIs:

```text
/api/auth/login
/api/auth/logout
/api/auth/me
/api/usuarios
```

## Login obligatorio

La web usa `middleware.js` para exigir sesion.

Si un usuario entra a cualquier URL del portal sin estar logueado, se redirige automaticamente a:

```text
/login
```

Despues de iniciar sesion, la home muestra solo los reportes permitidos para ese usuario.

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

## Tablas

```text
app_users
app_report_permissions
```

`app_users` guarda:

- `username`
- `password_hash`
- `role`: `admin` o `viewer`
- `enabled`
- `fecha_carga`

`app_report_permissions` guarda:

- `username`
- `report_key`
- `can_view`
- `fecha_carga`

## Roles

- `admin`: puede administrar usuarios y permisos. Tiene todos los reportes habilitados.
- `viewer`: puede tener permisos puntuales por reporte.

## Permisos visibles

Al iniciar sesion se cargan en la cookie de sesion los reportes permitidos del usuario.

La home usa esos permisos para mostrar solo los accesos habilitados.

Las rutas `/reportes/...` tambien verifican la sesion y redirigen a la home si el usuario no tiene el reporte asignado.

La ruta `/usuarios` queda reservada para usuarios con rol `admin`.
