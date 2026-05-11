import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <div className={styles.hero}>
        <h1 className={styles.title}>
          Ani<span className={styles.accent}>Draft</span>
        </h1>
        <p className={styles.subtitle}>
          Draft your favorite currently-airing anime. Compete with friends.
        </p>
        <div className={styles.status}>
          <span className={styles.badge}>🚧 Under Construction</span>
          <p className={styles.meta}>
            Turborepo monorepo scaffold — ready for development.
          </p>
        </div>
      </div>
    </main>
  );
}
