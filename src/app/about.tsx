import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Txt } from '@/components/ui/Txt';
import { colors, radius, useAccent } from '@/theme';

function Block({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Icon name={icon} color={colors.accent} />
        <Txt variant="heading">{title}</Txt>
      </View>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

const P = ({ children }: { children: ReactNode }) => (
  <Txt variant="body" style={{ color: colors.textDim }}>
    {children}
  </Txt>
);

function Credit({ name, what, url }: { name: string; what: string; url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      style={styles.credit}
      accessibilityRole="link"
      accessibilityLabel={`${name}: ${what}. Abrir ${url}`}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{name}</Txt>
        <Txt variant="caption">{what}</Txt>
      </View>
      <Icon name="open-in-new" size={18} color={colors.textMute} />
    </Pressable>
  );
}

export default function About() {
  useAccent();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Privacidad, usos y créditos" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
        <Block icon="shield-lock-outline" title="Privacidad">
          <P>
            Quartz reproduce los archivos de audio que ya están en tu teléfono. Tu biblioteca, listas, favoritas,
            ajustes y ecualizador se guardan solo en este dispositivo. No hay cuentas, anuncios, analíticas ni
            rastreadores, y la app no pide acceso a tu cámara ni a tu micrófono.
          </P>
          <P>
            Solo sale información del teléfono con las funciones en línea que activas en Ajustes (detalladas abajo, en
            Usos). Al desactivarlas dejan de enviarse datos.
          </P>
        </Block>

        <Block icon="information-outline" title="Usos">
          <P>
            • Letras en internet: si el archivo no trae letra, se envían a LRCLIB el título, artista, álbum y duración
            de la canción. Las letras se guardan en caché.
          </P>
          <P>
            • Portadas animadas: se busca el álbum en el catálogo de iTunes y se lee su página pública de Apple Music
            (se envían artista, álbum y título). Los vídeos se transmiten desde los servidores de Apple y gastan datos.
          </P>
          <P>
            • Discord: lo que escuchas se comparte con la app de Discord del teléfono. La portada se busca en iTunes
            (artista y álbum) y el icono del efecto activo se carga desde Twemoji.
          </P>
          <P>
            • Música libre: tus búsquedas se envían a Jamendo y a Internet Archive. Solo se ofrecen obras con licencia
            Creative Commons, de dominio público o conciertos que los artistas permiten compartir; las grabaciones que
            esos servicios marcan como solo para escuchar en línea no se pueden descargar. Cada descarga guarda su
            licencia y el enlace a la obra original.
          </P>
          <P>
            • Tus imágenes y vídeos para listas y visualizadores se copian dentro de la app y no salen del teléfono.
          </P>
          <P>• Los efectos de sonido se aplican en tiempo real; tus archivos nunca se modifican.</P>
        </Block>

        <Block icon="file-document-outline" title="Condiciones">
          <P>
            Quartz es un reproductor: no incluye, vende ni distribuye música. Úsalo solo con archivos y vídeos que
            tengas derecho a reproducir. Descargar o compartir música protegida sin autorización puede ser ilegal en tu
            país.
          </P>
          <P>
            Títulos, portadas y portadas animadas pertenecen a sus artistas y sellos. La pantalla siempre activa y los
            visualizadores consumen batería. La app se ofrece tal cual, sin garantías.
          </P>
        </Block>

        <Block icon="heart-outline" title="Créditos">
          <Credit name="LRCLIB" what="Letras sincronizadas" url="https://lrclib.net" />
          <Credit
            name="Apple Music · iTunes"
            what="Portadas animadas y búsqueda de álbumes"
            url="https://music.apple.com"
          />
          <Credit name="Jamendo" what="Música libre de artistas independientes" url="https://www.jamendo.com" />
          <Credit
            name="Internet Archive"
            what="Live Music Archive y audio de dominio público"
            url="https://archive.org"
          />
          <Credit
            name="Twemoji"
            what="Iconos de efectos en Discord · CC-BY 4.0"
            url="https://github.com/jdecked/twemoji"
          />
        </Block>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  credit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
});
